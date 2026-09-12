import { QuestionType, Difficulty } from './types';

// Extended types for multi-label and enhanced classification
export type ExtendedQuestionType = QuestionType | 'brain_teaser' | 'hr' | 'culture_fit';

export interface TopicTag {
  topic: string;
  category: 'data_structure' | 'algorithm' | 'concept' | 'language' | 'framework' | 'domain';
  confidence: number;
}

export interface ClassificationResult {
  type: QuestionType;
  confidence: number;
  signals: string[];
}

export interface MultiLabelClassification {
  labels: { type: ExtendedQuestionType; confidence: number; signals: string[] }[];
  primary: ExtendedQuestionType;
  primaryConfidence: number;
  isAmbiguous: boolean;
}

export interface DifficultyResult {
  difficulty: Difficulty;
  confidence: number;
  signals: string[];
  estimatedTimeMinutes?: number;
  complexityIndicators: string[];
}

export interface TopicTagResult {
  topics: TopicTag[];
  primaryTopic: string | null;
  relatedTopics: string[];
  leetcodePatterns: string[];
}

export interface ConfidenceScore {
  overall: number;
  typeConfidence: number;
  difficultyConfidence: number;
  topicConfidence: number;
  qualityScore: number;
  signals: {
    hasCodeBlock: boolean;
    hasExamples: boolean;
    hasConstraints: boolean;
    questionLength: 'short' | 'medium' | 'long';
    hasQuestionMark: boolean;
    languageClarity: number;
  };
}

// Topic patterns for DSA classification
const TOPIC_PATTERNS: { topic: string; category: TopicTag['category']; patterns: RegExp[]; weight: number }[] = [
  // Data Structures
  { topic: 'array', category: 'data_structure', patterns: [/\barray[s]?\b/i, /\blist[s]?\b/i, /\bvector[s]?\b/i, /\[\s*\d/, /\bsubarray\b/i], weight: 1.0 },
  { topic: 'string', category: 'data_structure', patterns: [/\bstring[s]?\b/i, /\bsubstring\b/i, /\bpalindrome\b/i, /\banagram\b/i, /\bcharacter\b/i], weight: 1.0 },
  { topic: 'linked_list', category: 'data_structure', patterns: [/\blinked\s*list/i, /\bsingly\s*linked/i, /\bdoubly\s*linked/i, /\bhead\s*(node|pointer)/i, /\breverse.*list/i], weight: 1.0 },
  { topic: 'tree', category: 'data_structure', patterns: [/\btree[s]?\b/i, /\bbinary\s*tree/i, /\bbst\b/i, /\broot\s*node/i, /\bleaf\s*node/i, /\bsubtree/i], weight: 1.0 },
  { topic: 'binary_tree', category: 'data_structure', patterns: [/\bbinary\s*tree/i, /\bbst\b/i, /\bbinary\s*search\s*tree/i, /\bleft\s*child/i, /\bright\s*child/i], weight: 1.0 },
  { topic: 'graph', category: 'data_structure', patterns: [/\bgraph[s]?\b/i, /\bnode[s]?\b/i, /\bedge[s]?\b/i, /\bvertex/i, /\bvertices/i, /\badjacen/i], weight: 1.0 },
  { topic: 'hash_map', category: 'data_structure', patterns: [/\bhash\s*(map|table|set)/i, /\bdictionary/i, /\bmap\b/i, /\bset\b/i, /\bfrequency\s*count/i], weight: 1.0 },
  { topic: 'stack', category: 'data_structure', patterns: [/\bstack[s]?\b/i, /\blifo\b/i, /\bpush\b.*\bpop\b/i, /\bmonotonic\s*stack/i], weight: 1.0 },
  { topic: 'queue', category: 'data_structure', patterns: [/\bqueue[s]?\b/i, /\bfifo\b/i, /\bdeque\b/i, /\bpriority\s*queue/i], weight: 1.0 },
  { topic: 'heap', category: 'data_structure', patterns: [/\bheap[s]?\b/i, /\bpriority\s*queue/i, /\bmin\s*heap/i, /\bmax\s*heap/i, /\bheapify/i], weight: 1.0 },
  { topic: 'trie', category: 'data_structure', patterns: [/\btrie[s]?\b/i, /\bprefix\s*tree/i, /\bautocomplete/i, /\bword\s*search/i], weight: 1.2 },
  { topic: 'matrix', category: 'data_structure', patterns: [/\bmatrix/i, /\b2d\s*array/i, /\bgrid\b/i, /\brow[s]?\b.*\bcol/i, /\bm\s*[x×]\s*n\b/i], weight: 1.0 },
  { topic: 'segment_tree', category: 'data_structure', patterns: [/\bsegment\s*tree/i, /\bfenwick/i, /\bbit\s*tree/i, /\brange\s*query/i], weight: 1.3 },
  { topic: 'union_find', category: 'data_structure', patterns: [/\bunion\s*find/i, /\bdisjoint\s*set/i, /\bconnected\s*component/i], weight: 1.2 },

  // Algorithms
  { topic: 'binary_search', category: 'algorithm', patterns: [/\bbinary\s*search/i, /\blow\b.*\bhigh\b/i, /\bmid\s*=.*\/\s*2/i, /\bsorted\s*array.*find/i], weight: 1.0 },
  { topic: 'two_pointers', category: 'algorithm', patterns: [/\btwo\s*pointer/i, /\bleft\b.*\bright\b/i, /\bslow\b.*\bfast\b/i, /\bconverge/i], weight: 1.0 },
  { topic: 'sliding_window', category: 'algorithm', patterns: [/\bsliding\s*window/i, /\bwindow\s*size/i, /\bsubarray.*length/i, /\bcontiguous\s*subarray/i], weight: 1.0 },
  { topic: 'dynamic_programming', category: 'algorithm', patterns: [/\bdynamic\s*programming/i, /\bdp\b/i, /\bmemoiz/i, /\btabulation/i, /\boptimal\s*substructure/i, /\boverlapping\s*subproblem/i], weight: 1.2 },
  { topic: 'recursion', category: 'algorithm', patterns: [/\brecursi/i, /\bbase\s*case/i, /\brecursive\s*call/i, /\bstack\s*overflow/i], weight: 0.9 },
  { topic: 'backtracking', category: 'algorithm', patterns: [/\bbacktrack/i, /\bpermutation/i, /\bcombination/i, /\bgenerate\s*all/i, /\bn\s*queens/i], weight: 1.2 },
  { topic: 'dfs', category: 'algorithm', patterns: [/\bdfs\b/i, /\bdepth\s*first/i, /\brecursive.*traverse/i, /\bpreorder|inorder|postorder/i], weight: 1.0 },
  { topic: 'bfs', category: 'algorithm', patterns: [/\bbfs\b/i, /\bbreadth\s*first/i, /\blevel\s*order/i, /\bshortest\s*path/i], weight: 1.0 },
  { topic: 'greedy', category: 'algorithm', patterns: [/\bgreedy/i, /\blocal\s*optim/i, /\binterval.*schedul/i, /\bactivity\s*selection/i], weight: 1.0 },
  { topic: 'sorting', category: 'algorithm', patterns: [/\bsort/i, /\bmerge\s*sort/i, /\bquick\s*sort/i, /\bheap\s*sort/i, /\bO\(n\s*log\s*n\)/i], weight: 0.9 },
  { topic: 'divide_conquer', category: 'algorithm', patterns: [/\bdivide\s*(and|&)?\s*conquer/i, /\bsplit.*merge/i, /\bpartition/i], weight: 1.1 },
  { topic: 'bit_manipulation', category: 'algorithm', patterns: [/\bbit\s*manipulation/i, /\bbitwise/i, /\bxor\b/i, /\b&\s*1\b/i, /\b<<|>>\b/], weight: 1.2 },
  { topic: 'math', category: 'algorithm', patterns: [/\bgcd\b/i, /\blcm\b/i, /\bprime/i, /\bfactorial/i, /\bmodulo/i, /\bmod\s*\d+/i, /\bsieve/i], weight: 0.9 },
  { topic: 'topological_sort', category: 'algorithm', patterns: [/\btopological/i, /\bdag\b/i, /\bdirected\s*acyclic/i, /\bcourse\s*schedule/i, /\bdependenc/i], weight: 1.2 },
  { topic: 'dijkstra', category: 'algorithm', patterns: [/\bdijkstra/i, /\bshortest\s*path/i, /\bweighted\s*graph/i, /\bminimum\s*distance/i], weight: 1.2 },
  { topic: 'kmp', category: 'algorithm', patterns: [/\bkmp\b/i, /\bknuth.*morris/i, /\bpattern\s*match/i, /\bfailure\s*function/i], weight: 1.3 },

  // Concepts
  { topic: 'time_complexity', category: 'concept', patterns: [/\btime\s*complexity/i, /\bbig\s*o/i, /\bO\([^)]+\)/i, /\bruntime/i], weight: 0.8 },
  { topic: 'space_complexity', category: 'concept', patterns: [/\bspace\s*complexity/i, /\bmemory/i, /\bin\s*place/i, /\bauxiliary\s*space/i], weight: 0.8 },
  { topic: 'concurrency', category: 'concept', patterns: [/\bconcurren/i, /\bthread/i, /\bparallel/i, /\block\b/i, /\bmutex/i, /\bsemaphore/i, /\brace\s*condition/i], weight: 1.1 },
  { topic: 'oop', category: 'concept', patterns: [/\bclass\b/i, /\bobject\s*oriented/i, /\binheritance/i, /\bpolymorphism/i, /\bencapsulation/i, /\babstraction/i], weight: 0.9 },
  { topic: 'design_patterns', category: 'concept', patterns: [/\bsingleton/i, /\bfactory/i, /\bobserver/i, /\bstrategy\s*pattern/i, /\bdecorator/i], weight: 1.0 },
  { topic: 'database', category: 'concept', patterns: [/\bsql\b/i, /\bquery/i, /\bjoin\b/i, /\bindex/i, /\bnormalization/i, /\btransaction/i], weight: 1.0 },

  // Languages/Frameworks
  { topic: 'python', category: 'language', patterns: [/\bpython/i, /\bdef\s+\w+\s*\(/i, /\bself\./i, /\bimport\s+\w+/i], weight: 0.7 },
  { topic: 'javascript', category: 'language', patterns: [/\bjavascript/i, /\bnode\.?js/i, /\bconst\s+\w+\s*=/i, /\b=>\s*{/i, /\basync\s*\/\s*await/i], weight: 0.7 },
  { topic: 'java', category: 'language', patterns: [/\bjava\b/i, /\bpublic\s+class/i, /\bArrayList/i, /\bHashMap/i, /\bvoid\s+\w+\s*\(/i], weight: 0.7 },
  { topic: 'cpp', category: 'language', patterns: [/\bc\+\+/i, /\bvector\s*</i, /\bstd::/i, /\btemplate\s*</i, /\b#include/i], weight: 0.7 },

  // Domain-specific
  { topic: 'ml_ai', category: 'domain', patterns: [/\bmachine\s*learning/i, /\bneural\s*network/i, /\bdeep\s*learning/i, /\bmodel\b/i, /\btraining/i, /\btensorflow/i, /\bpytorch/i], weight: 1.0 },
  { topic: 'system_design_topic', category: 'domain', patterns: [/\bscalabil/i, /\bdistributed/i, /\bmicroservice/i, /\bload\s*balanc/i, /\bcaching/i, /\bsharding/i], weight: 1.0 },
  { topic: 'api_design', category: 'domain', patterns: [/\brest\s*api/i, /\bendpoint/i, /\bhttp\s*method/i, /\bjson/i, /\bapi\s*design/i], weight: 0.9 },
];

// LeetCode pattern mapping
const LEETCODE_PATTERNS: { pattern: string; keywords: RegExp[] }[] = [
  { pattern: 'Two Pointers', keywords: [/two\s*pointer/i, /\bleft.*right\b/i, /\bstart.*end\b/i, /\bconverge/i] },
  { pattern: 'Sliding Window', keywords: [/sliding\s*window/i, /\bwindow\s*size/i, /\bmax.*subarray/i, /\blongest.*substring/i] },
  { pattern: 'Fast & Slow Pointers', keywords: [/fast.*slow/i, /\bcycle\s*detect/i, /\bfloyd/i, /\btortoise.*hare/i] },
  { pattern: 'Merge Intervals', keywords: [/\binterval/i, /\bmerge.*overlap/i, /\bmeeting\s*room/i] },
  { pattern: 'Cyclic Sort', keywords: [/cyclic\s*sort/i, /\bmissing\s*number/i, /\bduplicate.*array/i] },
  { pattern: 'In-place Reversal of LinkedList', keywords: [/reverse.*linked\s*list/i, /\bin\s*place.*revers/i] },
  { pattern: 'Tree BFS', keywords: [/level\s*order/i, /\bbfs.*tree/i, /\bbreadth.*tree/i] },
  { pattern: 'Tree DFS', keywords: [/\bdfs.*tree/i, /\bpreorder|inorder|postorder/i, /\bpath\s*sum/i] },
  { pattern: 'Two Heaps', keywords: [/two\s*heap/i, /\bmedian.*stream/i, /\bmin.*max\s*heap/i] },
  { pattern: 'Subsets', keywords: [/\bsubset/i, /\bpowerset/i, /\ball.*combination/i] },
  { pattern: 'Modified Binary Search', keywords: [/binary\s*search.*rotated/i, /\bsearch.*sorted/i, /\bpeak\s*element/i] },
  { pattern: 'Top K Elements', keywords: [/top\s*k/i, /\bk\s*largest/i, /\bk\s*smallest/i, /\bkth\s*(largest|smallest)/i] },
  { pattern: 'K-way Merge', keywords: [/k\s*way.*merge/i, /\bmerge\s*k.*sorted/i, /\bk\s*sorted\s*list/i] },
  { pattern: 'Topological Sort', keywords: [/topological/i, /\bcourse.*schedule/i, /\balien.*dictionary/i] },
  { pattern: '0/1 Knapsack', keywords: [/knapsack/i, /\bsubset\s*sum/i, /\bpartition.*equal/i] },
  { pattern: 'Unbounded Knapsack', keywords: [/unbounded.*knapsack/i, /\bcoin\s*change/i, /\brod\s*cutting/i] },
  { pattern: 'Fibonacci Numbers', keywords: [/fibonacci/i, /\bclimb.*stair/i, /\bhouse\s*robber/i] },
  { pattern: 'Palindromic Subsequence', keywords: [/palindrom.*subsequence/i, /\blongest.*palindrom/i] },
  { pattern: 'Longest Common Substring', keywords: [/longest\s*common/i, /\blcs\b/i, /\bedit\s*distance/i, /\blevenshtein/i] },
];

const TECHNICAL_SIGNALS = [
  { pattern: /\b(implement|write|code|function|algorithm|method|class)\b/i, weight: 0.3 },
  { pattern: /\b(time complexity|space complexity|big o|O\(n\)|O\(log|O\(1\))\b/i, weight: 0.4 },
  { pattern: /\b(array|string|tree|graph|linked list|hash|map|set|stack|queue|heap)\b/i, weight: 0.3 },
  { pattern: /\b(binary search|dfs|bfs|dp|dynamic programming|recursion|backtrack)\b/i, weight: 0.4 },
  { pattern: /\b(sort|reverse|rotate|merge|split|find|search|traverse)\b/i, weight: 0.2 },
  { pattern: /\b(leetcode|hackerrank|codility|topcoder)\b/i, weight: 0.5 },
  { pattern: /\bgiven\s+(an?\s+)?(array|string|list|tree|graph|number|integer)/i, weight: 0.4 },
  { pattern: /\b(return|output|print)\s+(the|a|an)?\s*(sum|count|index|length|max|min|result)/i, weight: 0.3 },
  { pattern: /\b(edge case|corner case|constraint|optimization)\b/i, weight: 0.2 },
  { pattern: /\b(input|output)\s*[:=]/i, weight: 0.3 },
  { pattern: /\bexample\s*\d*\s*[:=]?\s*\n?\s*(input|output|\[|\{)/i, weight: 0.3 },
  { pattern: /\b(two sum|three sum|valid parentheses|palindrome|anagram|substring)\b/i, weight: 0.5 },
  { pattern: /```[\s\S]*```/i, weight: 0.4 },
  { pattern: /\bdef\s+\w+\s*\(|function\s+\w+\s*\(|public\s+(static\s+)?\w+\s+\w+\s*\(/i, weight: 0.5 },
  { pattern: /\bfor\s*\(.*;\s*.*;\s*.*\)|while\s*\(|if\s*\(/i, weight: 0.3 },
  { pattern: /\breturn\s+[\w\[\]\.]+;?$/im, weight: 0.3 },
];

const BEHAVIORAL_SIGNALS = [
  { pattern: /\btell me about a time\b/i, weight: 0.6 },
  { pattern: /\b(describe|give me an example)\s+(a\s+)?(situation|time|project|challenge)\b/i, weight: 0.5 },
  { pattern: /\b(leadership|led|lead|managed|mentored)\b/i, weight: 0.3 },
  { pattern: /\b(conflict|disagreement|difficult|challenging)\s+(situation|person|coworker|teammate)\b/i, weight: 0.4 },
  { pattern: /\b(star method|situation|task|action|result)\b/i, weight: 0.4 },
  { pattern: /\b(amazon|lp|leadership principle)/i, weight: 0.3 },
  { pattern: /\b(customer obsession|ownership|bias for action|dive deep|have backbone|deliver results)\b/i, weight: 0.5 },
  { pattern: /\bhow do you handle\b/i, weight: 0.4 },
  { pattern: /\b(failure|mistake|wrong|failed)\b/i, weight: 0.2 },
  { pattern: /\b(team|teamwork|collaborate|collaboration)\b/i, weight: 0.2 },
  { pattern: /\b(prioritize|prioritization|deadline|pressure)\b/i, weight: 0.2 },
  { pattern: /\bwhy\s+(do you want|are you interested|this company|this role)\b/i, weight: 0.4 },
  { pattern: /\b(strength|weakness|improve|growth)\b/i, weight: 0.3 },
  { pattern: /\bwhat would you do if\b/i, weight: 0.3 },
  { pattern: /\bhow would you (approach|deal|respond|react)\b/i, weight: 0.3 },
  { pattern: /\bgreatest (achievement|accomplishment|success)\b/i, weight: 0.4 },
  { pattern: /\bwalk me through\s+(a|your)\b/i, weight: 0.3 },
];

const SYSTEM_DESIGN_SIGNALS = [
  { pattern: /\b(design|architect|build)\s+(a|an|the)?\s*(system|service|platform|application|api)\b/i, weight: 0.5 },
  { pattern: /\b(scalab|scale|million|billion|qps|rps|tps|throughput)\b/i, weight: 0.4 },
  { pattern: /\b(distributed|microservice|monolith|load balanc|caching|cdn|database)\b/i, weight: 0.4 },
  { pattern: /\b(availability|reliability|consistency|partition|cap theorem)\b/i, weight: 0.5 },
  { pattern: /\b(url shortener|twitter|facebook|instagram|uber|netflix|tinyurl|pastebin)\b/i, weight: 0.3 },
  { pattern: /\b(message queue|kafka|rabbitmq|sqs|pub.?sub)\b/i, weight: 0.4 },
  { pattern: /\b(redis|memcache|elasticsearch|mongodb|cassandra|dynamo)\b/i, weight: 0.3 },
  { pattern: /\b(api gateway|reverse proxy|nginx|kubernetes|docker)\b/i, weight: 0.3 },
  { pattern: /\b(sharding|replication|partitioning|indexing)\b/i, weight: 0.4 },
  { pattern: /\b(latency|bandwidth|network|http|rest|grpc|websocket)\b/i, weight: 0.2 },
  { pattern: /\bhow would you design\b/i, weight: 0.5 },
  { pattern: /\b(high level|architecture|component|diagram)\b/i, weight: 0.3 },
  { pattern: /\b(trade.?off|bottleneck|single point of failure)\b/i, weight: 0.4 },
  { pattern: /\b(horizontal|vertical)\s*scal/i, weight: 0.4 },
  { pattern: /\b(master|slave|leader|follower)\s*(node|replica)/i, weight: 0.4 },
  { pattern: /\bdatabase\s*(schema|design|model)/i, weight: 0.4 },
];

const OA_SIGNALS = [
  { pattern: /\b(online assessment|oa|hackerrank|codesignal|codility|karat)\b/i, weight: 0.6 },
  { pattern: /\b(timed|timer|\d+\s*minutes?|\d+\s*hours?)\b/i, weight: 0.3 },
  { pattern: /\b(proctored|webcam|screen share)\b/i, weight: 0.4 },
  { pattern: /\b(test case|sample input|sample output|hidden test)\b/i, weight: 0.4 },
  { pattern: /\b(question\s*[1-4]|problem\s*[1-4]|q[1-4])\b/i, weight: 0.3 },
  { pattern: /\b(debugging|bug fix|find the bug)\b/i, weight: 0.3 },
  { pattern: /\b(mcq|multiple choice|select all that apply)\b/i, weight: 0.4 },
  { pattern: /\b(gca|general coding assessment|coding test)\b/i, weight: 0.5 },
  { pattern: /\b(easy|medium|hard)\s+(question|problem)/i, weight: 0.2 },
  { pattern: /\btake.?home\s*(assignment|test|project)\b/i, weight: 0.4 },
  { pattern: /\b(passed|failed)\s*all\s*(test|cases)/i, weight: 0.4 },
  { pattern: /\b\d+\s*\/\s*\d+\s*(test|cases)/i, weight: 0.3 },
];

const BRAIN_TEASER_SIGNALS = [
  { pattern: /\b(puzzle|riddle|brain\s*teaser|trick\s*question)\b/i, weight: 0.6 },
  { pattern: /\b(fermi|estimation|guesstimate|market\s*sizing)\b/i, weight: 0.5 },
  { pattern: /\bhow many\s+(golf balls|piano tuners|gas stations|windows|cars)\b/i, weight: 0.6 },
  { pattern: /\b(manhole|light\s*bulb|airplane|bridge|river\s*crossing)\b/i, weight: 0.3 },
  { pattern: /\bwhy are\s+(manhole|tennis|pizza)\b/i, weight: 0.5 },
  { pattern: /\b(pirate|prisoner|hat|coin|weighing)\s*(puzzle|problem)\b/i, weight: 0.5 },
  { pattern: /\b(probability|expected\s*value|dice|cards)\b/i, weight: 0.3 },
  { pattern: /\b(jane\s*street|two\s*sigma|citadel|hrt|de\s*shaw)\b/i, weight: 0.2 },
  { pattern: /\bhow would you (measure|weigh|estimate|calculate)\b/i, weight: 0.3 },
  { pattern: /\b(marbles?|balls?|eggs?)\s*(in|on|from)\s*(a|the)?\s*(jar|box|building)\b/i, weight: 0.4 },
  { pattern: /\b(gold|fake|counterfeit)\s*(bar|coin)\b/i, weight: 0.5 },
];

const EASY_SIGNALS = [
  { pattern: /\b(easy|simple|basic|straightforward|beginner)\b/i, weight: 0.4 },
  { pattern: /\b(two sum|reverse string|palindrome|fizzbuzz|fibonacci)\b/i, weight: 0.5 },
  { pattern: /\bO\(n\)\b/i, weight: 0.2 },
  { pattern: /\b(array|string)\s+(manipulation|operation)\b/i, weight: 0.2 },
  { pattern: /\b(warm.?up|intro|introductory)\b/i, weight: 0.3 },
  { pattern: /\bfirst\s+(question|problem|round)\b/i, weight: 0.2 },
  { pattern: /\bphone\s*screen/i, weight: 0.2 },
];

const MEDIUM_SIGNALS = [
  { pattern: /\b(medium|moderate|intermediate)\b/i, weight: 0.4 },
  { pattern: /\b(binary search|two pointer|sliding window|hash map)\b/i, weight: 0.3 },
  { pattern: /\b(tree|graph|bfs|dfs)\b/i, weight: 0.2 },
  { pattern: /\b(O\(n log n\)|O\(n\*m\)|O\(n\^2\))\b/i, weight: 0.3 },
  { pattern: /\b(optimize|optimization|improve|better solution)\b/i, weight: 0.2 },
  { pattern: /\bfollow.?up\s*[:]/i, weight: 0.2 },
  { pattern: /\bonsite|virtual\s*onsite/i, weight: 0.2 },
];

const HARD_SIGNALS = [
  { pattern: /\b(hard|difficult|challenging|advanced|complex)\b/i, weight: 0.4 },
  { pattern: /\b(dp|dynamic programming|backtrack|trie|segment tree)\b/i, weight: 0.4 },
  { pattern: /\b(bit manipulation|bitwise)\b/i, weight: 0.3 },
  { pattern: /\b(follow.?up|edge case|corner case|tricky)\b/i, weight: 0.2 },
  { pattern: /\b(NP|polynomial|exponential|O\(2\^n\)|O\(n!\))\b/i, weight: 0.4 },
  { pattern: /\b(optimal|minimum|maximum|shortest|longest)\b/i, weight: 0.2 },
  { pattern: /\b(advanced|senior|staff)\s*(round|interview)/i, weight: 0.3 },
  { pattern: /\b(google|meta|facebook|apple|amazon|netflix)\s*(hard|final)/i, weight: 0.3 },
  { pattern: /\b(quant|trading|hedge\s*fund)\b/i, weight: 0.2 },
];

function calculateScore(text: string, signals: { pattern: RegExp; weight: number }[]): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];

  for (const { pattern, weight } of signals) {
    const match = text.match(pattern);
    if (match) {
      score += weight;
      matched.push(match[0]);
    }
  }

  return { score, matched };
}

// Topic Tagger class for DSA topic extraction
export class TopicTagger {
  tagTopics(text: string): TopicTagResult {
    const topics: TopicTag[] = [];
    const leetcodePatterns: string[] = [];

    // Extract DSA topics
    for (const { topic, category, patterns, weight } of TOPIC_PATTERNS) {
      let matchCount = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          matchCount++;
        }
      }
      if (matchCount > 0) {
        const confidence = Math.min(matchCount * weight * 0.3, 1.0);
        topics.push({ topic, category, confidence });
      }
    }

    // Extract LeetCode patterns
    for (const { pattern, keywords } of LEETCODE_PATTERNS) {
      for (const keyword of keywords) {
        if (keyword.test(text)) {
          if (!leetcodePatterns.includes(pattern)) {
            leetcodePatterns.push(pattern);
          }
          break;
        }
      }
    }

    // Sort by confidence
    topics.sort((a, b) => b.confidence - a.confidence);

    // Determine primary topic and related topics
    const primaryTopic = topics.length > 0 ? topics[0].topic : null;
    const relatedTopics = topics.slice(1, 4).map(t => t.topic);

    return {
      topics,
      primaryTopic,
      relatedTopics,
      leetcodePatterns,
    };
  }
}

// Difficulty Estimator class with time estimation
export class DifficultyEstimator {
  estimate(text: string): DifficultyResult {
    const easy = calculateScore(text, EASY_SIGNALS);
    const medium = calculateScore(text, MEDIUM_SIGNALS);
    const hard = calculateScore(text, HARD_SIGNALS);

    const scores: { difficulty: Difficulty; score: number; signals: string[] }[] = [
      { difficulty: 'easy', score: easy.score, signals: easy.matched },
      { difficulty: 'medium', score: medium.score, signals: medium.matched },
      { difficulty: 'hard', score: hard.score, signals: hard.matched },
    ];

    scores.sort((a, b) => b.score - a.score);
    const topScore = scores[0];

    // Complexity indicators
    const complexityIndicators: string[] = [];
    if (/O\(n\^2\)|O\(n\*m\)/i.test(text)) complexityIndicators.push('quadratic');
    if (/O\(n\s*log\s*n\)/i.test(text)) complexityIndicators.push('log-linear');
    if (/O\(2\^n\)|O\(n!\)/i.test(text)) complexityIndicators.push('exponential');
    if (/O\(n\)|O\(m\+n\)/i.test(text)) complexityIndicators.push('linear');
    if (/O\(1\)/i.test(text)) complexityIndicators.push('constant');
    if (/O\(log\s*n\)/i.test(text)) complexityIndicators.push('logarithmic');

    // Estimate time in minutes based on difficulty
    let estimatedTimeMinutes: number | undefined;
    if (topScore.score > 0) {
      switch (topScore.difficulty) {
        case 'easy':
          estimatedTimeMinutes = 15;
          break;
        case 'medium':
          estimatedTimeMinutes = 30;
          break;
        case 'hard':
          estimatedTimeMinutes = 45;
          break;
      }
    }

    if (topScore.score === 0) {
      return {
        difficulty: 'unknown',
        confidence: 0,
        signals: [],
        complexityIndicators,
      };
    }

    const confidence = Math.min(topScore.score / 1.5, 1);

    return {
      difficulty: topScore.difficulty,
      confidence: Math.round(confidence * 100) / 100,
      signals: topScore.signals,
      estimatedTimeMinutes,
      complexityIndicators,
    };
  }
}

// Confidence Scorer class for overall quality assessment
export class ConfidenceScorer {
  score(text: string, typeResult: ClassificationResult, difficultyResult: DifficultyResult, topicResult: TopicTagResult): ConfidenceScore {
    const hasCodeBlock = /```[\s\S]*```/.test(text) || /^(def |function |public |private |class )/m.test(text);
    const hasExamples = /example[s]?\s*[:=\d]/i.test(text) || /input\s*[:=]/i.test(text);
    const hasConstraints = /constraint[s]?[:=]/i.test(text) || /\d+\s*<=?\s*\w+\s*<=?\s*\d+/.test(text);
    const hasQuestionMark = text.includes('?');

    let questionLength: 'short' | 'medium' | 'long';
    if (text.length < 100) questionLength = 'short';
    else if (text.length < 500) questionLength = 'medium';
    else questionLength = 'long';

    // Language clarity score based on various heuristics
    let languageClarity = 0.5;
    if (/^[A-Z]/.test(text.trim())) languageClarity += 0.1; // Proper capitalization
    if (/[.!?]$/.test(text.trim())) languageClarity += 0.1; // Proper punctuation
    if (!/[^\x00-\x7F]/.test(text) || /[一-鿿]/.test(text)) languageClarity += 0.1; // ASCII or Chinese (intentional)
    if (text.split(/\s+/).length > 10) languageClarity += 0.1; // Reasonable word count
    languageClarity = Math.min(languageClarity, 1);

    // Calculate quality score
    let qualityScore = 0.3; // Base score
    if (hasCodeBlock) qualityScore += 0.15;
    if (hasExamples) qualityScore += 0.2;
    if (hasConstraints) qualityScore += 0.15;
    if (questionLength === 'medium' || questionLength === 'long') qualityScore += 0.1;
    if (topicResult.topics.length > 0) qualityScore += 0.1;
    qualityScore = Math.min(qualityScore, 1);

    // Calculate overall confidence
    const typeConfidence = typeResult.confidence;
    const difficultyConfidence = difficultyResult.confidence;
    const topicConfidence = topicResult.topics.length > 0
      ? Math.min(topicResult.topics.reduce((sum, t) => sum + t.confidence, 0) / topicResult.topics.length, 1)
      : 0;

    const overall = (
      typeConfidence * 0.35 +
      difficultyConfidence * 0.25 +
      topicConfidence * 0.2 +
      qualityScore * 0.2
    );

    return {
      overall: Math.round(overall * 100) / 100,
      typeConfidence,
      difficultyConfidence,
      topicConfidence,
      qualityScore: Math.round(qualityScore * 100) / 100,
      signals: {
        hasCodeBlock,
        hasExamples,
        hasConstraints,
        questionLength,
        hasQuestionMark,
        languageClarity: Math.round(languageClarity * 100) / 100,
      },
    };
  }
}

// Multi-label classifier for questions that fit multiple categories
export function classifyQuestionMultiLabel(text: string): MultiLabelClassification {
  const technical = calculateScore(text, TECHNICAL_SIGNALS);
  const behavioral = calculateScore(text, BEHAVIORAL_SIGNALS);
  const systemDesign = calculateScore(text, SYSTEM_DESIGN_SIGNALS);
  const oa = calculateScore(text, OA_SIGNALS);
  const brainTeaser = calculateScore(text, BRAIN_TEASER_SIGNALS);

  const allScores: { type: ExtendedQuestionType; score: number; signals: string[] }[] = [
    { type: 'technical', score: technical.score, signals: technical.matched },
    { type: 'behavioral', score: behavioral.score, signals: behavioral.matched },
    { type: 'system_design', score: systemDesign.score, signals: systemDesign.matched },
    { type: 'oa', score: oa.score, signals: oa.matched },
    { type: 'brain_teaser', score: brainTeaser.score, signals: brainTeaser.matched },
  ];

  // Normalize scores and calculate confidences
  const maxScore = Math.max(...allScores.map(s => s.score));
  const labels = allScores
    .filter(s => s.score > 0)
    .map(s => ({
      type: s.type,
      confidence: maxScore > 0 ? Math.min(s.score / 2, 1) : 0,
      signals: s.signals,
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const primary = labels.length > 0 ? labels[0].type : 'unknown' as ExtendedQuestionType;
  const primaryConfidence = labels.length > 0 ? labels[0].confidence : 0;

  // Check if ambiguous (top two are close)
  const isAmbiguous = labels.length >= 2 &&
    (labels[0].confidence - labels[1].confidence) < 0.15;

  return {
    labels,
    primary,
    primaryConfidence,
    isAmbiguous,
  };
}

// Original single-label classifier (maintained for backwards compatibility)
export function classifyQuestion(text: string): ClassificationResult {
  const multiLabel = classifyQuestionMultiLabel(text);

  // Map brain_teaser to technical for backwards compatibility
  let type: QuestionType = multiLabel.primary === 'brain_teaser' ? 'technical' : multiLabel.primary as QuestionType;
  if (type !== 'technical' && type !== 'behavioral' && type !== 'system_design' && type !== 'oa') {
    type = 'unknown';
  }

  return {
    type,
    confidence: multiLabel.primaryConfidence,
    signals: multiLabel.labels.length > 0 ? multiLabel.labels[0].signals : [],
  };
}

export function classifyDifficulty(text: string): DifficultyResult {
  const estimator = new DifficultyEstimator();
  return estimator.estimate(text);
}

export function isValidQuestion(text: string): boolean {
  if (!text || text.trim().length < 10) return false;
  if (text.trim().length > 5000) return false;

  const lowQualityPatterns = [
    /^(hi|hello|hey|thanks|thank you|good luck)/i,
    /^\s*\?+\s*$/,
    /^(yes|no|ok|okay|sure|maybe)\s*$/i,
    /^(idk|dunno|not sure)/i,
    /^(bump|following|interested)/i,
    /^(lol|lmao|haha|nice|cool|awesome)\s*$/i,
    /^(anyone|somebody|help)\s*\??\s*$/i,
  ];

  for (const pattern of lowQualityPatterns) {
    if (pattern.test(text.trim())) return false;
  }

  const classification = classifyQuestion(text);
  return classification.type !== 'unknown' || text.includes('?') || text.length > 100;
}

export function extractQuestions(text: string): string[] {
  const questions: string[] = [];

  const questionPatterns = [
    /(?:^|\n)\s*(?:\d+[\.\)]\s*|[-*•]\s*|Q\d*[:.\s]*)?([^?\n]*\?)/gm,
    /(?:^|\n)\s*(?:Question\s*\d*[:.\s]*)?([A-Z][^?\n]*\?)/gm,
  ];

  for (const pattern of questionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const question = match[1]?.trim();
      if (question && question.length > 15 && isValidQuestion(question)) {
        if (!questions.includes(question)) {
          questions.push(question);
        }
      }
    }
  }

  const bulletPoints = text.split(/\n/).filter(line => {
    const trimmed = line.trim();
    return (
      /^(?:\d+[\.\)]\s*|[-*•]\s*)/.test(trimmed) &&
      trimmed.length > 20 &&
      isValidQuestion(trimmed)
    );
  });

  for (const point of bulletPoints) {
    const cleaned = point.replace(/^(?:\d+[\.\)]\s*|[-*•]\s*)/, '').trim();
    if (cleaned && !questions.includes(cleaned)) {
      questions.push(cleaned);
    }
  }

  return questions;
}

// Full analysis combining all classifiers
export interface FullQuestionAnalysis {
  text: string;
  classification: MultiLabelClassification;
  difficulty: DifficultyResult;
  topics: TopicTagResult;
  confidence: ConfidenceScore;
  isValid: boolean;
}

export function analyzeQuestion(text: string): FullQuestionAnalysis {
  const classification = classifyQuestionMultiLabel(text);
  const difficultyEstimator = new DifficultyEstimator();
  const topicTagger = new TopicTagger();
  const confidenceScorer = new ConfidenceScorer();

  const difficulty = difficultyEstimator.estimate(text);
  const topics = topicTagger.tagTopics(text);
  const singleLabel = classifyQuestion(text);
  const confidence = confidenceScorer.score(text, singleLabel, difficulty, topics);
  const isValid = isValidQuestion(text);

  return {
    text,
    classification,
    difficulty,
    topics,
    confidence,
    isValid,
  };
}
