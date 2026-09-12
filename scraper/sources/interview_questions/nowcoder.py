"""Nowcoder (牛客网) interview experience scraper.

Scrapes interview experiences from nowcoder.com/discuss/tag/639 (面经区).
Parses: company name, position, interview date, round details, questions.
Includes Chinese to English translation.

Date filter: Last 4-5 months for relevance.

UPGRADED: Uses new infrastructure for:
- GeoProxySelector for China proxies
- ResponseCache for caching
- UniversalDateParser for Chinese dates
- StealthSession for anti-detection
- ValidationPipeline for data quality
"""

import re
import hashlib
import time
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict

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
    from ...utils.date_parser import UniversalDateParser, parse_date
    from ...utils.anti_detection import create_stealth_session, StealthSession
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
            _checkpoint = CheckpointManager("nowcoder")
        except Exception:
            pass
    return _checkpoint

# Fallback to requests if infrastructure not available
try:
    import requests
except ImportError:
    requests = None

from .quant_finance import InterviewQuestion

# Nowcoder interview experience section
NOWCODER_BASE_URL = "https://www.nowcoder.com"
NOWCODER_DISCUSS_URL = "https://www.nowcoder.com/discuss/tag/639"  # 面经区
NOWCODER_API_URL = "https://www.nowcoder.com/discuss/tag/all"

# Request settings
REQUEST_TIMEOUT = 30
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.nowcoder.com/",
}

# Initialize infrastructure components
_stealth_session: Optional['StealthSession'] = None
_response_cache: Optional['ResponseCache'] = None
_date_parser: Optional['UniversalDateParser'] = None
_geo_proxy: Optional['GeoProxySelector'] = None
_incremental: Optional['IncrementalScraper'] = None

def _init_infrastructure():
    """Initialize infrastructure components if available."""
    global _stealth_session, _response_cache, _date_parser, _geo_proxy, _incremental

    if not HAS_INFRASTRUCTURE:
        return

    if _stealth_session is None:
        _stealth_session = create_stealth_session(
            min_delay=1.5,
            max_delay=4.0,
            requests_per_minute=15  # Conservative for Nowcoder
        )

    if _response_cache is None:
        _response_cache = ResponseCache(ttl=3600 * 6)  # 6 hour cache

    if _date_parser is None:
        _date_parser = UniversalDateParser()

    if _geo_proxy is None:
        _geo_proxy = GeoProxySelector()

    if _incremental is None:
        _incremental = IncrementalScraper('nowcoder_interviews')


def _make_request(url: str, params: Optional[Dict] = None) -> Optional[str]:
    """Make request using infrastructure or fallback to basic requests."""
    _init_infrastructure()

    if HAS_INFRASTRUCTURE and _stealth_session and _response_cache:
        # Check cache first
        cache_key = f"{url}:{str(params)}" if params else url
        cached = _response_cache.get(cache_key)
        if cached:
            return cached

        # Get proxy for China
        proxies = None
        if _geo_proxy:
            proxy = _geo_proxy.get_proxy_for_url(url)
            if proxy:
                proxies = {"http": proxy, "https": proxy}

        # Use stealth session
        config = _stealth_session.get_request_config(url)
        if _stealth_session.before_request():
            try:
                response = requests.get(
                    url,
                    params=params,
                    headers=config.get('headers', DEFAULT_HEADERS),
                    proxies=proxies,
                    timeout=REQUEST_TIMEOUT,
                    verify=False
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
                headers=DEFAULT_HEADERS,
                timeout=REQUEST_TIMEOUT,
                verify=False
            )
            if response.ok:
                return response.text
        except Exception as e:
            print(f"Fallback request error: {e}")

    return None


# Legacy HEADERS for backward compatibility
HEADERS = DEFAULT_HEADERS

# Common Chinese company names to English mapping
COMPANY_NAME_MAP = {
    # FAANG / Big Tech
    "谷歌": "Google",
    "字节跳动": "ByteDance",
    "字节": "ByteDance",
    "抖音": "ByteDance (TikTok)",
    "腾讯": "Tencent",
    "阿里巴巴": "Alibaba",
    "阿里": "Alibaba",
    "蚂蚁": "Ant Group",
    "蚂蚁金服": "Ant Group",
    "百度": "Baidu",
    "微软": "Microsoft",
    "亚马逊": "Amazon",
    "苹果": "Apple",
    "脸书": "Meta",
    "Facebook": "Meta",
    "Meta": "Meta",
    "英伟达": "NVIDIA",
    "英特尔": "Intel",
    "高通": "Qualcomm",
    "华为": "Huawei",
    "小米": "Xiaomi",
    "OPPO": "OPPO",
    "vivo": "Vivo",
    "联想": "Lenovo",
    # Finance / Trading
    "摩根士丹利": "Morgan Stanley",
    "高盛": "Goldman Sachs",
    "摩根大通": "JP Morgan",
    "花旗": "Citibank",
    "汇丰": "HSBC",
    # Chinese Tech
    "美团": "Meituan",
    "滴滴": "Didi",
    "京东": "JD.com",
    "拼多多": "Pinduoduo",
    "快手": "Kuaishou",
    "网易": "NetEase",
    "携程": "Trip.com",
    "大疆": "DJI",
    "商汤": "SenseTime",
    "旷视": "Megvii",
    "小红书": "Xiaohongshu",
    "哔哩哔哩": "Bilibili",
    "B站": "Bilibili",
    "贝壳": "KE Holdings",
    "蔚来": "NIO",
    "小鹏": "XPeng",
    "理想": "Li Auto",
    # Singapore / SEA
    "Shopee": "Shopee",
    "Grab": "Grab",
    "Sea": "Sea Limited",
    # Others
    "甲骨文": "Oracle",
    "思科": "Cisco",
    "IBM": "IBM",
    "三星": "Samsung",
    "Uber": "Uber",
    "Airbnb": "Airbnb",
    "LinkedIn": "LinkedIn",
    "Stripe": "Stripe",
}

# Role name translations
ROLE_MAP = {
    "软件工程师": "Software Engineer",
    "后端工程师": "Backend Engineer",
    "后端开发": "Backend Engineer",
    "前端工程师": "Frontend Engineer",
    "前端开发": "Frontend Engineer",
    "全栈工程师": "Full Stack Engineer",
    "算法工程师": "Algorithm Engineer",
    "机器学习工程师": "ML Engineer",
    "数据工程师": "Data Engineer",
    "数据分析师": "Data Analyst",
    "产品经理": "Product Manager",
    "测试工程师": "QA Engineer",
    "运维工程师": "DevOps Engineer",
    "安全工程师": "Security Engineer",
    "iOS工程师": "iOS Engineer",
    "Android工程师": "Android Engineer",
    "移动端工程师": "Mobile Engineer",
    "客户端工程师": "Client Engineer",
    "研发工程师": "R&D Engineer",
    "开发工程师": "Software Developer",
    "Java开发": "Java Developer",
    "C++开发": "C++ Developer",
    "Python开发": "Python Developer",
    "Go开发": "Go Developer",
    "校招": "New Grad",
    "实习": "Intern",
    "社招": "Experienced",
}

# Question type keywords
QUESTION_TYPE_KEYWORDS = {
    "coding": ["算法", "代码", "编程", "leetcode", "coding", "手撕", "刷题", "数组", "链表", "二叉树", "动态规划", "DP", "排序", "递归"],
    "system_design": ["系统设计", "架构", "设计", "高并发", "分布式", "微服务", "缓存", "数据库设计", "system design"],
    "behavioral": ["行为面", "HR面", "文化面", "价值观", "团队", "项目经历", "自我介绍", "behavioral"],
    "online_assessment": ["笔试", "OA", "机考", "在线测试", "online assessment", "笔试题"],
    "technical": ["技术面", "八股文", "基础知识", "原理", "底层", "源码", "计算机网络", "操作系统", "数据库"],
}

# Topic keywords for tagging
TOPIC_KEYWORDS = {
    "arrays": ["数组", "array"],
    "linked-list": ["链表", "linked list"],
    "binary-tree": ["二叉树", "binary tree", "树"],
    "hash-table": ["哈希", "hash"],
    "dynamic-programming": ["动态规划", "DP", "dp"],
    "recursion": ["递归", "recursion"],
    "sorting": ["排序", "sort"],
    "graph": ["图", "graph"],
    "bfs": ["BFS", "广度优先"],
    "dfs": ["DFS", "深度优先"],
    "stack": ["栈", "stack"],
    "queue": ["队列", "queue"],
    "heap": ["堆", "heap", "优先队列"],
    "greedy": ["贪心", "greedy"],
    "backtracking": ["回溯", "backtrack"],
    "string": ["字符串", "string"],
    "database": ["数据库", "database", "MySQL", "Redis", "SQL"],
    "networking": ["网络", "HTTP", "TCP", "网络协议"],
    "os": ["操作系统", "进程", "线程", "内存"],
    "concurrency": ["并发", "多线程", "锁"],
    "java": ["Java", "JVM", "Spring"],
    "python": ["Python"],
    "cpp": ["C++", "STL"],
    "golang": ["Go", "Golang"],
    "javascript": ["JavaScript", "JS", "前端"],
}


def translate_company_name(chinese_name: str) -> str:
    """Translate Chinese company name to English."""
    chinese_name = chinese_name.strip()

    if chinese_name in COMPANY_NAME_MAP:
        return COMPANY_NAME_MAP[chinese_name]

    for cn, en in COMPANY_NAME_MAP.items():
        if cn in chinese_name or chinese_name in cn:
            return en

    return chinese_name


def translate_role(chinese_role: str) -> str:
    """Translate Chinese role name to English."""
    chinese_role = chinese_role.strip()

    for cn, en in ROLE_MAP.items():
        if cn in chinese_role:
            return en

    return chinese_role


def classify_question_type(text: str) -> str:
    """Classify the question type based on keywords."""
    text_lower = text.lower()

    for q_type, keywords in QUESTION_TYPE_KEYWORDS.items():
        for keyword in keywords:
            if keyword.lower() in text_lower:
                return q_type

    return "technical"


def estimate_difficulty(text: str) -> str:
    """Estimate difficulty based on content."""
    text_lower = text.lower()

    hard_keywords = ["hard", "困难", "难", "复杂", "高级", "资深", "senior"]
    easy_keywords = ["easy", "简单", "基础", "初级", "入门", "junior"]

    for kw in hard_keywords:
        if kw in text_lower:
            return "hard"

    for kw in easy_keywords:
        if kw in text_lower:
            return "easy"

    return "medium"


def extract_tags(text: str) -> List[str]:
    """Extract topic tags from question text."""
    tags = []
    text_lower = text.lower()

    for tag, keywords in TOPIC_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if tag not in tags:
                    tags.append(tag)
                break

    return tags[:5]


def parse_interview_date(date_str: str) -> Optional[str]:
    """Parse Chinese date formats and return ISO format string.

    Uses UniversalDateParser if available, falls back to manual parsing.
    """
    _init_infrastructure()

    # Try using infrastructure date parser (supports 15+ languages)
    if HAS_INFRASTRUCTURE and _date_parser:
        try:
            parsed = _date_parser.parse(date_str, language='zh')
            if parsed and parsed.date:
                return parsed.date.strftime("%Y-%m-%d")
        except Exception:
            pass

    # Fallback to manual parsing
    now = datetime.now()
    result_date = None

    if "刚刚" in date_str or "分钟前" in date_str or "小时前" in date_str:
        result_date = now

    elif "天前" in date_str:
        match = re.search(r"(\d+)天前", date_str)
        if match:
            days = int(match.group(1))
            result_date = now - timedelta(days=days)

    elif "周前" in date_str:
        match = re.search(r"(\d+)周前", date_str)
        if match:
            weeks = int(match.group(1))
            result_date = now - timedelta(weeks=weeks)

    elif "月前" in date_str:
        match = re.search(r"(\d+)月前", date_str)
        if match:
            months = int(match.group(1))
            result_date = now - timedelta(days=months * 30)

    else:
        patterns = [
            (r"(\d{4})-(\d{1,2})-(\d{1,2})", None),
            (r"(\d{4})年(\d{1,2})月(\d{1,2})日", None),
            (r"(\d{4})\.(\d{1,2})\.(\d{1,2})", None),
        ]

        for pattern, _ in patterns:
            match = re.search(pattern, date_str)
            if match:
                try:
                    year = int(match.group(1))
                    month = int(match.group(2))
                    day = int(match.group(3))
                    result_date = datetime(year, month, day)
                    break
                except ValueError:
                    pass

    return result_date.strftime("%Y-%m-%d") if result_date else None


def extract_questions_from_text(text: str) -> List[str]:
    """Extract individual questions from interview experience text."""
    questions = []

    question_indicators = [
        r"问题\s*[:：]",
        r"题目\s*[:：]",
        r"面试官\s*[:：]",
        r"Q\s*[:：]",
        r"\d+[\.\)、]\s*",
        r"[一二三四五六七八九十]+[\.\)、]\s*",
    ]

    lines = text.split("\n")

    for line in lines:
        line = line.strip()
        if not line or len(line) < 10:
            continue

        is_question = False
        for indicator in question_indicators:
            if re.match(indicator, line):
                is_question = True
                line = re.sub(indicator, "", line).strip()
                break

        if not is_question:
            question_words = ["如何", "什么", "为什么", "怎么", "解释", "描述", "实现", "设计", "写出"]
            for word in question_words:
                if word in line:
                    is_question = True
                    break

        if is_question and len(line) > 10:
            questions.append(line[:500])

    seen = set()
    unique_questions = []
    for q in questions:
        q_normalized = q.strip().lower()
        if q_normalized not in seen:
            seen.add(q_normalized)
            unique_questions.append(q.strip())

    return unique_questions[:20]


def generate_question_id(company: str, position: str, question: str) -> str:
    """Generate unique ID for a question."""
    content = f"nowcoder:{company}:{position}:{question}"
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def fetch_nowcoder_discuss_list(page: int = 1, tag_id: int = 639) -> Optional[Dict]:
    """Fetch discussion list from Nowcoder API."""
    url = f"{NOWCODER_API_URL}"
    params = {
        "tagId": tag_id,
        "page": page,
        "pageSize": 30,
        "order": 3,  # Sort by time
    }

    try:
        response_text = _make_request(url, params)
        if response_text:
            import json
            data = json.loads(response_text)
            if data.get("code") == 0:
                return data.get("data", {})
        return None
    except Exception as e:
        print(f"Error fetching Nowcoder page {page}: {e}")
        return None


def fetch_nowcoder_page_html(page: int = 1) -> Optional[str]:
    """Fetch a page from Nowcoder interview section via HTML scraping.

    Uses ResponseCache and GeoProxySelector if available.
    """
    url = f"{NOWCODER_DISCUSS_URL}?page={page}"
    return _make_request(url)


def fetch_post_detail(post_url: str) -> Optional[str]:
    """Fetch detailed content of a single post.

    Uses ResponseCache and incremental scraping if available.
    """
    _init_infrastructure()

    if not post_url.startswith("http"):
        post_url = NOWCODER_BASE_URL + post_url

    # Check incremental scraper to skip already-processed posts
    if HAS_INFRASTRUCTURE and _incremental:
        post_id = re.search(r'/discuss/(\d+)', post_url)
        if post_id and _incremental.has_seen(post_id.group(1)):
            return None  # Skip already processed

    return _make_request(post_url)


def parse_post_list_html(html: str) -> List[Dict]:
    """Parse the list of interview experience posts from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    posts = []

    post_elements = soup.select(".discuss-main .common-list .list-item, .post-list .post-item, [class*='discuss-item']")

    if not post_elements:
        post_elements = soup.select("a[href*='/discuss/']")

    for elem in post_elements:
        try:
            if elem.name == "a":
                title_elem = elem
            else:
                title_elem = elem.select_one("a[href*='/discuss/']")

            if not title_elem:
                continue

            title = title_elem.get_text(strip=True)
            url = title_elem.get("href", "")

            if not url or "/discuss/" not in url:
                continue

            date_elem = elem.select_one(".time, .post-time, [class*='time']")
            date_str = date_elem.get_text(strip=True) if date_elem else ""

            company = ""
            for company_cn in COMPANY_NAME_MAP.keys():
                if company_cn in title:
                    company = translate_company_name(company_cn)
                    break

            position = ""
            for role_cn in ROLE_MAP.keys():
                if role_cn in title:
                    position = translate_role(role_cn)
                    break

            posts.append({
                "title": title,
                "url": url,
                "date_str": date_str,
                "company": company,
                "position": position,
            })
        except Exception as e:
            continue

    return posts


def parse_post_detail(html: str, base_info: Dict) -> List[InterviewQuestion]:
    """Parse detailed interview experience and extract questions."""
    soup = BeautifulSoup(html, "html.parser")
    questions = []

    content_elem = soup.select_one(".post-topic-main, .discuss-main .post-content, .nc-post-content, article, .content")
    if not content_elem:
        return questions

    content_text = content_elem.get_text(separator="\n", strip=True)

    company = base_info.get("company", "")
    if not company:
        for company_cn, company_en in COMPANY_NAME_MAP.items():
            if company_cn in content_text:
                company = company_en
                break

    position = base_info.get("position", "")
    if not position:
        title = base_info.get("title", "")
        combined = title + " " + content_text[:500]
        for role_cn, role_en in ROLE_MAP.items():
            if role_cn in combined:
                position = role_en
                break

    if not position:
        position = "Software Engineer"

    posted_date = parse_interview_date(base_info.get("date_str", ""))

    extracted_questions = extract_questions_from_text(content_text)

    for q_text in extracted_questions:
        q_type = classify_question_type(q_text)
        difficulty = estimate_difficulty(q_text)
        tags = extract_tags(q_text)

        source_url = base_info.get("url", "")
        if source_url and not source_url.startswith("http"):
            source_url = NOWCODER_BASE_URL + source_url

        question = InterviewQuestion(
            id=generate_question_id(company, position, q_text),
            company=company if company else "Unknown",
            position=position,
            question_type=q_type,
            difficulty=difficulty,
            question_text=q_text,
            source="nowcoder",
            source_url=source_url,
            posted_date=posted_date,
            tags=tags,
        )
        questions.append(question)

    return questions


def scrape_nowcoder(
    max_pages: int = 10,
    months_back: int = 5,
    company_filter: Optional[str] = None,
    role_filter: Optional[str] = None,
    use_validation: bool = True,
) -> List[InterviewQuestion]:
    """
    Scrape interview questions from Nowcoder (牛客网).

    Uses new infrastructure if available:
    - GeoProxySelector for China proxies
    - ResponseCache for caching
    - UniversalDateParser for Chinese dates
    - StealthSession for anti-detection
    - ValidationPipeline for data quality
    - Monitoring for metrics

    Args:
        max_pages: Maximum number of pages to scrape
        months_back: Only include posts from the last N months
        company_filter: Optional company name to filter by
        role_filter: Optional role name to filter by
        use_validation: Whether to validate scraped data

    Returns:
        List of InterviewQuestion objects
    """
    _init_infrastructure()

    all_questions: List[InterviewQuestion] = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)
    extracted_count = 0
    duplicate_count = 0

    print(f"Scraping Nowcoder interview experiences (last {months_back} months)...")
    if HAS_INFRASTRUCTURE:
        print("  [INFO] Using infrastructure: caching, proxies, anti-detection, validation")

    for page in range(1, max_pages + 1):
        print(f"  Fetching page {page}/{max_pages}...")

        html = fetch_nowcoder_page_html(page)
        if not html:
            print(f"  Failed to fetch page {page}, stopping.")
            break

        posts = parse_post_list_html(html)
        print(f"  Found {len(posts)} posts on page {page}")

        if not posts:
            print(f"  No more posts found, stopping.")
            break

        for post in posts:
            if company_filter:
                post_company = post.get("company", "").lower()
                if not post_company or company_filter.lower() not in post_company:
                    continue

            post_date_str = parse_interview_date(post.get("date_str", ""))
            if post_date_str:
                try:
                    post_date = datetime.strptime(post_date_str, "%Y-%m-%d")
                    if post_date < cutoff_date:
                        print(f"  Reached posts older than {months_back} months, stopping.")
                        # Save incremental state
                        if HAS_INFRASTRUCTURE and _incremental:
                            _incremental.save_state()
                        return all_questions
                except ValueError:
                    pass

            if not post.get("url"):
                continue

            detail_html = fetch_post_detail(post["url"])
            if not detail_html:
                continue

            questions = parse_post_detail(detail_html, post)
            extracted_count += len(questions)

            if role_filter:
                questions = [q for q in questions if role_filter.lower() in q.position.lower()]

            # Mark as seen in incremental scraper
            if HAS_INFRASTRUCTURE and _incremental:
                post_id = re.search(r'/discuss/(\d+)', post.get("url", ""))
                if post_id:
                    _incremental.mark_seen(post_id.group(1))

            all_questions.extend(questions)

            if questions:
                print(f"    Extracted {len(questions)} questions from: {post.get('title', '')[:40]}...")

        # Add delay between pages
        if HAS_INFRASTRUCTURE and _stealth_session:
            time.sleep(1.5)

    # Validate data if infrastructure available
    if use_validation and HAS_INFRASTRUCTURE:
        try:
            validated = validate_questions([asdict(q) for q in all_questions])
            valid_count = len([v for v in validated if v.get('is_valid', True)])
            print(f"  Validation: {valid_count}/{len(all_questions)} passed quality checks")
        except Exception as e:
            print(f"  Validation skipped: {e}")

    # Save incremental state
    if HAS_INFRASTRUCTURE and _incremental:
        _incremental.save_state()

    print(f"Total questions scraped from Nowcoder: {len(all_questions)}")
    return all_questions


def test_scrape():
    """Test the scraper with limited scope."""
    questions = scrape_nowcoder(max_pages=2, months_back=3)

    print(f"\n=== Test Results ===")
    print(f"Total questions: {len(questions)}")

    for q in questions[:5]:
        print(f"\n--- Question ---")
        print(f"Company: {q.company}")
        print(f"Position: {q.position}")
        print(f"Type: {q.question_type}")
        print(f"Difficulty: {q.difficulty}")
        print(f"Tags: {q.tags}")
        print(f"Question: {q.question_text[:100]}...")


if __name__ == "__main__":
    test_scrape()
