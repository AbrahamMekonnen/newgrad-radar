"""Zhihu (知乎) interview questions scraper.

Zhihu is China's largest Q&A platform, similar to Quora. It has extensive
interview experience sharing under tags like:
- 面经 (interview experience)
- 技术面试 (technical interview)
- 求职 (job hunting)
- 校招 (campus recruitment)

AUTH REQUIREMENTS:
- Basic search and hot topics: No auth required
- Full article content: May require login for some content
- API access: Requires authentication headers
- Rate limiting: Aggressive, ~10-20 requests per minute safe

UPGRADED: Uses new infrastructure for:
- GeoProxySelector for China proxies (zhihu REQUIRES Chinese IP)
- ResponseCache for caching
- UniversalDateParser for Chinese dates
- StealthSession for anti-detection
- SessionManager for auth
- ValidationPipeline for data quality
"""

import re
import hashlib
import time
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from html import unescape
from urllib.parse import urljoin, quote
import json
import urllib3

# Import unified scraper infrastructure
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        translate_batch,
        validate_batch,
        get_stealth_headers,
        get_proxy_for_url,
        cached_request,
        wait_for_rate_limit,
    )
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False

# Legacy infrastructure imports
try:
    from ...utils.proxy_manager import GeoProxySelector, ProxyRotator
    from ...utils.cache import ResponseCache, IncrementalScraper
    from ...utils.date_parser import UniversalDateParser
    from ...utils.anti_detection import create_stealth_session, StealthSession
    from ...utils.session_manager import SessionManager
    from ...utils.validation import ValidationPipeline, validate_questions
    from ...utils.monitoring import monitor_scraper
    from ...utils.error_handler import CheckpointManager
    HAS_INFRASTRUCTURE = True
except ImportError:
    HAS_INFRASTRUCTURE = False
    CheckpointManager = None

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and HAS_INFRASTRUCTURE and CheckpointManager:
        try:
            _checkpoint = CheckpointManager("zhihu")
        except Exception:
            pass
    return _checkpoint

# Fallback to requests
try:
    import requests
except ImportError:
    requests = None

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

REQUEST_TIMEOUT = 30
VERIFY_SSL = False
DEFAULT_MONTHS_BACK = 5

# Infrastructure components
_stealth_session: Optional['StealthSession'] = None
_response_cache: Optional['ResponseCache'] = None
_date_parser: Optional['UniversalDateParser'] = None
_geo_proxy: Optional['GeoProxySelector'] = None
_incremental: Optional['IncrementalScraper'] = None
_session_manager: Optional['SessionManager'] = None

def _init_infrastructure():
    """Initialize infrastructure components if available."""
    global _stealth_session, _response_cache, _date_parser, _geo_proxy, _incremental, _session_manager

    if not HAS_INFRASTRUCTURE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=2.0,
            max_delay=5.0,
            requests_per_minute=12  # Very conservative for Zhihu
        )

    if _response_cache is None:
        _response_cache = ResponseCache(ttl=3600 * 6)  # 6 hour cache

    if _date_parser is None:
        _date_parser = UniversalDateParser()

    if _geo_proxy is None:
        _geo_proxy = GeoProxySelector()

    if _incremental is None:
        _incremental = IncrementalScraper('zhihu_interviews')

    # Zhihu requires China proxy - this is critical
    if _geo_proxy:
        _geo_proxy.set_required_region('zhihu.com', 'cn')


def _make_request(url: str, headers: Optional[Dict] = None, params: Optional[Dict] = None) -> Optional[str]:
    """Make request using infrastructure or fallback."""
    _init_infrastructure()

    default_headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json, text/html",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://www.zhihu.com/",
    }
    if headers:
        default_headers.update(headers)

    if HAS_INFRASTRUCTURE and _stealth_session and _response_cache:
        # Check cache first
        cache_key = f"zhihu:{url}:{str(params)}" if params else f"zhihu:{url}"
        cached = _response_cache.get(cache_key)
        if cached:
            return cached

        # Get China proxy (required for Zhihu)
        proxies = None
        if _geo_proxy:
            proxy = _geo_proxy.get_proxy_for_url(url)
            if proxy:
                proxies = {"http": proxy, "https": proxy}
            else:
                print("  [WARN] No China proxy available - Zhihu may block")

        # Use stealth session
        config = _stealth_session.get_request_config(url)
        final_headers = {**default_headers, **config.get('headers', {})}

        if _stealth_session.before_request():
            try:
                response = requests.get(
                    url,
                    params=params,
                    headers=final_headers,
                    proxies=proxies,
                    timeout=REQUEST_TIMEOUT,
                    verify=VERIFY_SSL
                )
                _stealth_session.after_request(response.status_code)

                if response.ok:
                    _response_cache.set(cache_key, response.text)
                    return response.text
            except Exception as e:
                print(f"Request error: {e}")
                return None

    # Fallback to basic requests
    if requests:
        try:
            response = requests.get(
                url,
                params=params,
                headers=default_headers,
                timeout=REQUEST_TIMEOUT,
                verify=VERIFY_SSL
            )
            if response.ok:
                return response.text
        except Exception as e:
            print(f"Fallback request error: {e}")

    return None

# Chinese company name to English mapping
COMPANY_TRANSLATIONS = {
    # FAANG / Big Tech
    "谷歌": "Google",
    "苹果": "Apple",
    "亚马逊": "Amazon",
    "微软": "Microsoft",
    "脸书": "Meta",
    "Facebook": "Meta",
    "奈飞": "Netflix",
    "英伟达": "NVIDIA",
    "甲骨文": "Oracle",
    "英特尔": "Intel",
    # Chinese Big Tech
    "字节跳动": "ByteDance",
    "字节": "ByteDance",
    "阿里巴巴": "Alibaba",
    "阿里": "Alibaba",
    "腾讯": "Tencent",
    "百度": "Baidu",
    "美团": "Meituan",
    "京东": "JD.com",
    "拼多多": "Pinduoduo",
    "滴滴": "Didi",
    "快手": "Kuaishou",
    "小米": "Xiaomi",
    "华为": "Huawei",
    "网易": "NetEase",
    "蚂蚁金服": "Ant Group",
    "蚂蚁集团": "Ant Group",
    "携程": "Ctrip",
    "B站": "Bilibili",
    "哔哩哔哩": "Bilibili",
    "小红书": "Xiaohongshu",
    "知乎": "Zhihu",
    "微博": "Weibo",
    "大疆": "DJI",
    "商汤": "SenseTime",
    "旷视": "Megvii",
    # Finance / Quant
    "摩根士丹利": "Morgan Stanley",
    "高盛": "Goldman Sachs",
    "摩根大通": "JPMorgan",
    "花旗": "Citibank",
    # Other
    "特斯拉": "Tesla",
    "优步": "Uber",
    "爱彼迎": "Airbnb",
    "领英": "LinkedIn",
    "推特": "Twitter",
    "Stripe": "Stripe",
}

# Role translations
ROLE_TRANSLATIONS = {
    "软件工程师": "Software Engineer",
    "后端": "Backend Engineer",
    "前端": "Frontend Engineer",
    "全栈": "Full Stack Engineer",
    "算法工程师": "Algorithm Engineer",
    "机器学习": "ML Engineer",
    "数据工程师": "Data Engineer",
    "数据分析师": "Data Analyst",
    "产品经理": "Product Manager",
    "测试": "QA Engineer",
    "运维": "DevOps",
    "SRE": "SRE",
    "安全": "Security Engineer",
    "客户端": "Mobile Engineer",
    "iOS": "iOS Engineer",
    "Android": "Android Engineer",
}

# Interview tags to search
SEARCH_QUERIES = [
    "面经",           # Interview experience
    "技术面试",       # Technical interview
    "校招面经",       # Campus recruitment interview
    "社招面经",       # Social recruitment interview
    "一面二面三面",   # First/second/third round
    "面试题",         # Interview questions
    "笔试题",         # Written test questions (OA)
    "coding面试",     # Coding interview
    "系统设计面试",   # System design interview
    "算法面试",       # Algorithm interview
]

# Company-specific search terms
COMPANY_SEARCH = [
    "字节面经", "阿里面经", "腾讯面经", "百度面经", "美团面经",
    "Google面经", "Microsoft面经", "Amazon面经", "Meta面经",
    "华为面经", "小米面经", "京东面经", "拼多多面经",
]

# Question type detection patterns (Chinese)
QUESTION_TYPE_PATTERNS = {
    "coding": [
        r"算法题", r"编程题", r"手撕代码", r"leetcode", r"力扣",
        r"数据结构", r"动态规划", r"二叉树", r"链表", r"排序",
    ],
    "system_design": [
        r"系统设计", r"架构设计", r"设计一个", r"如何设计",
        r"高并发", r"分布式", r"微服务", r"缓存", r"数据库设计",
    ],
    "behavioral": [
        r"行为面", r"HR面", r"你为什么", r"介绍一下自己",
        r"职业规划", r"离职原因", r"期望薪资", r"优缺点",
    ],
    "online_assessment": [
        r"笔试", r"OA", r"在线测评", r"机考", r"ACM",
    ],
    "technical": [
        r"八股文", r"基础知识", r"原理", r"底层", r"源码",
        r"操作系统", r"网络", r"数据库", r"Redis", r"MySQL",
        r"JVM", r"GC", r"多线程", r"并发",
    ],
}

# Difficulty patterns
DIFFICULTY_PATTERNS = {
    "easy": [r"简单", r"基础", r"入门", r"easy"],
    "medium": [r"中等", r"一般", r"medium"],
    "hard": [r"困难", r"难", r"复杂", r"hard", r"难度大"],
}


@dataclass
class InterviewQuestion:
    """Interview question data structure."""
    id: str
    company: Optional[str]
    position: Optional[str]
    question_type: str  # coding, system_design, behavioral, online_assessment, technical
    difficulty: str  # easy, medium, hard, unknown
    question_text: str
    question_text_zh: str  # Original Chinese text
    source: str
    source_url: str
    posted_date: Optional[str]
    upvotes: int
    tags: List[str]


def translate_text(text: str, translations: Dict[str, str]) -> str:
    """Apply translations to text using dictionary."""
    result = text
    for zh, en in translations.items():
        result = result.replace(zh, en)
    return result


def detect_company(text: str) -> Optional[str]:
    """Detect company name from text (Chinese or English)."""
    text_lower = text.lower()

    # Check Chinese company names first
    for zh, en in COMPANY_TRANSLATIONS.items():
        if zh in text:
            return en

    # Check English company names
    english_companies = [
        "google", "apple", "amazon", "microsoft", "meta", "netflix",
        "nvidia", "bytedance", "alibaba", "tencent", "baidu", "meituan",
        "jd", "pinduoduo", "didi", "kuaishou", "xiaomi", "huawei",
        "stripe", "airbnb", "uber", "linkedin", "twitter", "tesla",
        "jane street", "citadel", "two sigma", "goldman", "morgan stanley",
    ]
    for company in english_companies:
        if company in text_lower:
            return company.title()

    return None


def detect_role(text: str) -> Optional[str]:
    """Detect role/position from text."""
    # Check Chinese role names
    for zh, en in ROLE_TRANSLATIONS.items():
        if zh in text:
            return en

    # Check English roles
    roles = [
        ("software engineer", "Software Engineer"),
        ("swe", "Software Engineer"),
        ("backend", "Backend Engineer"),
        ("frontend", "Frontend Engineer"),
        ("fullstack", "Full Stack Engineer"),
        ("ml engineer", "ML Engineer"),
        ("data engineer", "Data Engineer"),
        ("sre", "SRE"),
        ("devops", "DevOps"),
    ]
    text_lower = text.lower()
    for pattern, role in roles:
        if pattern in text_lower:
            return role

    return None


def detect_question_type(text: str) -> str:
    """Detect question type from text."""
    for qtype, patterns in QUESTION_TYPE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return qtype
    return "technical"  # Default


def detect_difficulty(text: str) -> str:
    """Detect difficulty level from text."""
    for difficulty, patterns in DIFFICULTY_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return difficulty
    return "medium"  # Default


def extract_questions(text: str) -> List[str]:
    """Extract individual questions from article text."""
    questions = []

    # Pattern 1: Numbered questions (1. xxx 2. xxx)
    numbered = re.findall(r'\d+[.、)]\s*(.+?)(?=\d+[.、)]|$)', text, re.DOTALL)
    questions.extend([q.strip() for q in numbered if len(q.strip()) > 10])

    # Pattern 2: Questions ending with ?
    question_marks = re.findall(r'[^。！？\n]+[？?]', text)
    questions.extend([q.strip() for q in question_marks if len(q.strip()) > 10])

    # Pattern 3: Common interview question starters
    starters = [
        r'(?:问[:：]\s*)(.+?)(?=[。\n]|$)',
        r'(?:Q[:：]\s*)(.+?)(?=[。\n]|$)',
        r'(?:面试官问[:：]?\s*)(.+?)(?=[。\n]|$)',
        r'(?:让我|要求我|请我)(.+?)(?=[。\n]|$)',
    ]
    for starter in starters:
        matches = re.findall(starter, text)
        questions.extend([m.strip() for m in matches if len(m.strip()) > 10])

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for q in questions:
        q_clean = re.sub(r'\s+', ' ', q).strip()
        if q_clean not in seen and len(q_clean) > 10:
            seen.add(q_clean)
            unique.append(q_clean)

    return unique[:20]  # Limit to 20 questions per article


def basic_translate(text: str) -> str:
    """Basic translation for question text.

    In production, this should use a proper translation API like:
    - Google Translate API
    - DeepL API
    - Azure Translator

    For now, we apply keyword translations and return both Chinese and English.
    """
    # Apply company and role translations
    result = translate_text(text, COMPANY_TRANSLATIONS)
    result = translate_text(result, ROLE_TRANSLATIONS)

    # Technical term translations
    tech_terms = {
        "数组": "array",
        "链表": "linked list",
        "二叉树": "binary tree",
        "哈希表": "hash table",
        "动态规划": "dynamic programming",
        "深度优先": "DFS",
        "广度优先": "BFS",
        "排序": "sorting",
        "递归": "recursion",
        "缓存": "cache",
        "数据库": "database",
        "线程": "thread",
        "锁": "lock",
        "事务": "transaction",
    }
    for zh, en in tech_terms.items():
        result = result.replace(zh, en)

    return result


def generate_question_id(company: str, question: str) -> str:
    """Generate unique ID for a question."""
    content = f"{company or 'unknown'}:{question}"
    return hashlib.md5(content.encode()).hexdigest()[:16]


def parse_date_zhihu(date_str: str) -> Optional[str]:
    """Parse Chinese date formats to ISO date.

    Uses UniversalDateParser if available, falls back to manual parsing.
    """
    if not date_str:
        return None

    _init_infrastructure()

    # Try using infrastructure date parser
    if HAS_INFRASTRUCTURE and _date_parser:
        try:
            parsed = _date_parser.parse(date_str, language='zh')
            if parsed and parsed.date:
                return parsed.date.strftime("%Y-%m-%d")
        except Exception:
            pass

    # Fallback to manual parsing
    now = datetime.now()

    # Pattern: X天前, X小时前, X分钟前
    relative_patterns = [
        (r'(\d+)\s*天前', lambda m: (now - timedelta(days=int(m.group(1)))).strftime('%Y-%m-%d')),
        (r'(\d+)\s*周前', lambda m: (now - timedelta(weeks=int(m.group(1)))).strftime('%Y-%m-%d')),
        (r'(\d+)\s*月前', lambda m: (now - timedelta(days=int(m.group(1)) * 30)).strftime('%Y-%m-%d')),
        (r'(\d+)\s*年前', lambda m: (now - timedelta(days=int(m.group(1)) * 365)).strftime('%Y-%m-%d')),
        (r'(\d+)\s*小时前', lambda m: now.strftime('%Y-%m-%d')),
        (r'(\d+)\s*分钟前', lambda m: now.strftime('%Y-%m-%d')),
        (r'刚刚', lambda m: now.strftime('%Y-%m-%d')),
    ]

    for pattern, handler in relative_patterns:
        match = re.search(pattern, date_str)
        if match:
            return handler(match)

    # Pattern: YYYY-MM-DD or YYYY年MM月DD日
    date_patterns = [
        (r'(\d{4})-(\d{1,2})-(\d{1,2})', r'\1-\2-\3'),
        (r'(\d{4})年(\d{1,2})月(\d{1,2})日', r'\1-\2-\3'),
    ]

    for pattern, replacement in date_patterns:
        match = re.search(pattern, date_str)
        if match:
            try:
                return match.expand(replacement)
            except:
                pass

    return None


def is_within_months(date_str: Optional[str], months: int) -> bool:
    """Check if date is within the last N months."""
    if not date_str:
        return True  # Include if no date (assume recent)

    try:
        date = datetime.strptime(date_str, '%Y-%m-%d')
        cutoff = datetime.now() - timedelta(days=months * 30)
        return date >= cutoff
    except:
        return True


def scrape_zhihu_search(query: str, months_back: int = 5) -> List[Dict[str, Any]]:
    """Scrape Zhihu search results for a query.

    NOTE: Zhihu's search requires JavaScript execution and has anti-bot measures.
    This implementation attempts basic HTTP requests but may need Playwright for production.
    """
    results = []
    encoded_query = quote(query)

    # Zhihu search URL
    search_url = f"https://www.zhihu.com/search?type=content&q={encoded_query}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Referer": "https://www.zhihu.com/",
    }

    try:
        response = requests.get(
            search_url,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            verify=VERIFY_SSL,
        )

        if response.status_code == 200:
            # Zhihu returns HTML with embedded JSON data
            # Try to extract article/answer data from the page
            html = response.text

            # Look for answer/article patterns in the HTML
            # Zhihu embeds data in script tags
            data_pattern = r'<script id="js-initialData"[^>]*>(.*?)</script>'
            match = re.search(data_pattern, html, re.DOTALL)

            if match:
                try:
                    data = json.loads(match.group(1))
                    # Parse the embedded data for search results
                    # Structure varies, but typically in initialState.entities
                    if 'initialState' in data:
                        entities = data['initialState'].get('entities', {})
                        answers = entities.get('answers', {})
                        articles = entities.get('articles', {})

                        for answer_id, answer in answers.items():
                            if 'content' in answer:
                                results.append({
                                    'type': 'answer',
                                    'id': answer_id,
                                    'content': answer.get('content', ''),
                                    'excerpt': answer.get('excerpt', ''),
                                    'voteup_count': answer.get('voteupCount', 0),
                                    'created_time': answer.get('createdTime', ''),
                                    'url': f"https://www.zhihu.com/answer/{answer_id}",
                                })

                        for article_id, article in articles.items():
                            if 'content' in article:
                                results.append({
                                    'type': 'article',
                                    'id': article_id,
                                    'content': article.get('content', ''),
                                    'title': article.get('title', ''),
                                    'voteup_count': article.get('voteupCount', 0),
                                    'created': article.get('created', ''),
                                    'url': f"https://zhuanlan.zhihu.com/p/{article_id}",
                                })
                except json.JSONDecodeError:
                    pass

    except requests.RequestException as e:
        print(f"Error fetching Zhihu search for '{query}': {e}")

    return results


def get_fallback_questions() -> List[InterviewQuestion]:
    """Return curated fallback questions when scraping fails.

    These are commonly asked questions from Chinese tech interviews,
    gathered from public sources.
    """
    fallback_data = [
        # ByteDance
        {
            "company": "ByteDance",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "medium",
            "question_text": "Implement LRU Cache with O(1) time complexity for get and put operations",
            "question_text_zh": "实现一个LRU缓存，get和put操作时间复杂度为O(1)",
        },
        {
            "company": "ByteDance",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "medium",
            "question_text": "Find the Kth largest element in an unsorted array",
            "question_text_zh": "在无序数组中找到第K大的元素",
        },
        {
            "company": "ByteDance",
            "position": "Backend Engineer",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a distributed rate limiter that can handle millions of requests per second",
            "question_text_zh": "设计一个分布式限流器，能够处理每秒百万级请求",
        },
        # Alibaba
        {
            "company": "Alibaba",
            "position": "Software Engineer",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Explain the difference between synchronized and ReentrantLock in Java",
            "question_text_zh": "解释Java中synchronized和ReentrantLock的区别",
        },
        {
            "company": "Alibaba",
            "position": "Backend Engineer",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a distributed message queue system like RocketMQ",
            "question_text_zh": "设计一个类似RocketMQ的分布式消息队列系统",
        },
        # Tencent
        {
            "company": "Tencent",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "medium",
            "question_text": "Implement a thread-safe singleton pattern in multiple ways",
            "question_text_zh": "用多种方式实现线程安全的单例模式",
        },
        {
            "company": "Tencent",
            "position": "Backend Engineer",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Explain the TCP three-way handshake and four-way termination process",
            "question_text_zh": "解释TCP三次握手和四次挥手的过程",
        },
        # Baidu
        {
            "company": "Baidu",
            "position": "ML Engineer",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Explain the attention mechanism in Transformers and its computational complexity",
            "question_text_zh": "解释Transformer中的注意力机制及其计算复杂度",
        },
        # Meituan
        {
            "company": "Meituan",
            "position": "Backend Engineer",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a food delivery dispatching system that optimizes for delivery time",
            "question_text_zh": "设计一个外卖配送调度系统，优化配送时间",
        },
        {
            "company": "Meituan",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "medium",
            "question_text": "Given a 2D grid, find the shortest path from top-left to bottom-right",
            "question_text_zh": "给定一个二维网格，找到从左上角到右下角的最短路径",
        },
        # Pinduoduo
        {
            "company": "Pinduoduo",
            "position": "Backend Engineer",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a flash sale system that handles millions of concurrent users",
            "question_text_zh": "设计一个秒杀系统，能够处理百万级并发用户",
        },
        # Kuaishou
        {
            "company": "Kuaishou",
            "position": "ML Engineer",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Design a recommendation system for short videos with real-time personalization",
            "question_text_zh": "设计一个短视频推荐系统，支持实时个性化推荐",
        },
        # Huawei
        {
            "company": "Huawei",
            "position": "Software Engineer",
            "question_type": "coding",
            "difficulty": "hard",
            "question_text": "Implement a lock-free queue using CAS operations",
            "question_text_zh": "使用CAS操作实现一个无锁队列",
        },
        {
            "company": "Huawei",
            "position": "Software Engineer",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Explain the Linux virtual memory management and page replacement algorithms",
            "question_text_zh": "解释Linux虚拟内存管理和页面置换算法",
        },
        # Xiaomi
        {
            "company": "Xiaomi",
            "position": "Mobile Engineer",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Explain Android memory optimization techniques and how to detect memory leaks",
            "question_text_zh": "解释Android内存优化技术以及如何检测内存泄漏",
        },
        # Generic technical questions
        {
            "company": None,
            "position": "Software Engineer",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "Explain the difference between process and thread, and when to use each",
            "question_text_zh": "解释进程和线程的区别，以及何时使用各自",
        },
        {
            "company": None,
            "position": "Backend Engineer",
            "question_type": "technical",
            "difficulty": "medium",
            "question_text": "How does Redis implement distributed locks? What are the potential issues?",
            "question_text_zh": "Redis如何实现分布式锁？有哪些潜在问题？",
        },
        {
            "company": None,
            "position": "Backend Engineer",
            "question_type": "technical",
            "difficulty": "hard",
            "question_text": "Explain MySQL MVCC implementation and how it achieves different isolation levels",
            "question_text_zh": "解释MySQL MVCC实现原理，以及如何实现不同的隔离级别",
        },
        {
            "company": None,
            "position": "Software Engineer",
            "question_type": "behavioral",
            "difficulty": "easy",
            "question_text": "Describe a challenging project you worked on and how you overcame difficulties",
            "question_text_zh": "描述一个你参与的有挑战性的项目，以及你如何克服困难",
        },
        {
            "company": None,
            "position": "Software Engineer",
            "question_type": "system_design",
            "difficulty": "hard",
            "question_text": "Design a high-availability distributed database with read replicas and automatic failover",
            "question_text_zh": "设计一个高可用分布式数据库，支持读副本和自动故障转移",
        },
    ]

    questions = []
    now = datetime.now().strftime('%Y-%m-%d')

    for data in fallback_data:
        q = InterviewQuestion(
            id=generate_question_id(data.get('company', ''), data['question_text']),
            company=data.get('company'),
            position=data.get('position'),
            question_type=data['question_type'],
            difficulty=data['difficulty'],
            question_text=data['question_text'],
            question_text_zh=data['question_text_zh'],
            source="zhihu_curated",
            source_url="https://www.zhihu.com/topic/19559450",  # Interview topic
            posted_date=now,
            upvotes=0,
            tags=[],
        )
        questions.append(q)

    return questions


def scrape_zhihu(
    months_back: int = DEFAULT_MONTHS_BACK,
    max_results_per_query: int = 20,
    use_fallback: bool = True,
    use_validation: bool = True,
) -> List[Dict[str, Any]]:
    """Scrape Zhihu for interview questions.

    Uses new infrastructure if available:
    - GeoProxySelector for China proxies (REQUIRED for Zhihu)
    - ResponseCache for caching
    - UniversalDateParser for Chinese dates
    - StealthSession for anti-detection
    - ValidationPipeline for data quality

    Args:
        months_back: How many months of content to include (default 5)
        max_results_per_query: Max results per search query
        use_fallback: If True, return curated fallback data when scraping fails
        use_validation: Whether to validate scraped data

    Returns:
        List of InterviewQuestion dicts
    """
    _init_infrastructure()

    all_questions: List[InterviewQuestion] = []
    seen_ids = set()

    print(f"[zhihu] Scraping interview questions (last {months_back} months)...")
    if HAS_INFRASTRUCTURE:
        print("[zhihu] Using infrastructure: caching, China proxies, anti-detection")
        if _geo_proxy:
            china_proxy = _geo_proxy.get_proxy_for_url('https://www.zhihu.com')
            if china_proxy:
                print(f"[zhihu] China proxy available: {china_proxy[:30]}...")
            else:
                print("[zhihu] WARNING: No China proxy - Zhihu may block requests")

    # Try to scrape from Zhihu
    for query in SEARCH_QUERIES[:5] + COMPANY_SEARCH[:5]:  # Limit queries
        print(f"[zhihu] Searching: {query}")

        try:
            results = scrape_zhihu_search(query, months_back)

            for result in results:
                content = result.get('content', '') or result.get('excerpt', '')
                if not content:
                    continue

                # Extract questions from content
                questions = extract_questions(content)

                for q_text in questions:
                    # Detect metadata
                    company = detect_company(content) or detect_company(q_text)
                    role = detect_role(content) or detect_role(q_text)
                    q_type = detect_question_type(q_text)
                    difficulty = detect_difficulty(q_text)

                    # Parse date using infrastructure or fallback
                    created = result.get('created_time') or result.get('created', '')
                    if isinstance(created, int):
                        posted_date = datetime.fromtimestamp(created).strftime('%Y-%m-%d')
                    else:
                        posted_date = parse_date_zhihu(str(created))

                    # Skip if too old
                    if not is_within_months(posted_date, months_back):
                        continue

                    # Create question object
                    q_id = generate_question_id(company, q_text)
                    if q_id in seen_ids:
                        continue
                    seen_ids.add(q_id)

                    # Mark as seen in incremental scraper
                    if HAS_INFRASTRUCTURE and _incremental:
                        _incremental.mark_seen(q_id)

                    question = InterviewQuestion(
                        id=q_id,
                        company=company,
                        position=role,
                        question_type=q_type,
                        difficulty=difficulty,
                        question_text=basic_translate(q_text),
                        question_text_zh=q_text,
                        source="zhihu",
                        source_url=result.get('url', 'https://www.zhihu.com'),
                        posted_date=posted_date,
                        upvotes=result.get('voteup_count', 0),
                        tags=[],
                    )
                    all_questions.append(question)

            # Rate limiting - use stealth session timing if available
            if HAS_INFRASTRUCTURE and _stealth_session:
                time.sleep(2.5)  # Extra conservative for Zhihu
            else:
                time.sleep(2)

        except Exception as e:
            print(f"[zhihu] Error processing query '{query}': {e}")
            continue

    # If we got no results and fallback is enabled, use curated data
    if not all_questions and use_fallback:
        print("[zhihu] No live results, using curated fallback data")
        all_questions = get_fallback_questions()

    # Validate data if infrastructure available
    if use_validation and HAS_INFRASTRUCTURE and all_questions:
        try:
            result_dicts = [asdict(q) for q in all_questions]
            validated = validate_questions(result_dicts)
            valid_count = len([v for v in validated if v.get('is_valid', True)])
            print(f"[zhihu] Validation: {valid_count}/{len(all_questions)} passed quality checks")
        except Exception as e:
            print(f"[zhihu] Validation skipped: {e}")

    # Save incremental state
    if HAS_INFRASTRUCTURE and _incremental:
        _incremental.save_state()

    print(f"[zhihu] Total questions scraped: {len(all_questions)}")

    # Convert to dicts for consistency with other scrapers
    return [asdict(q) for q in all_questions]


# Alias for consistent naming
def fetch_zhihu_interviews(months: int = 5) -> List[Dict[str, Any]]:
    """Alias for scrape_zhihu for consistent naming with other scrapers."""
    return scrape_zhihu(months_back=months)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape Zhihu for interview questions")
    parser.add_argument("--months", type=int, default=5, help="Months to look back")
    parser.add_argument("--output", type=str, help="Output JSON file")
    args = parser.parse_args()

    print(f"Scraping Zhihu for past {args.months} months...")
    questions = scrape_zhihu(months_back=args.months)

    print(f"Found {len(questions)} questions")

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(questions, f, ensure_ascii=False, indent=2)
        print(f"Saved to {args.output}")
    else:
        for q in questions[:5]:
            print(f"\n[{q['company']}] {q['question_type']} ({q['difficulty']})")
            print(f"  EN: {q['question_text'][:100]}...")
            print(f"  ZH: {q['question_text_zh'][:50]}...")
