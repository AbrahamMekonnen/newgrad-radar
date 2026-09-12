"""
Universal Date Parser for Interview Posts

Handles date parsing across 15+ languages with support for:
- Relative dates ("3 days ago", "hace 2 días", "3天前", "2日前")
- Timezone handling with automatic detection
- Interview date vs post date distinction
- Date range extraction
- Ambiguous date resolution (01/02/2024 US vs EU)
- Japanese fiscal year (令和, 平成)
- Korean date formats
- Chinese date formats
- Russian date formats
- Arabic date formats
- Various ISO and locale-specific formats
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple, List, Dict, Any
from dataclasses import dataclass
from enum import Enum
import calendar


class DateFormat(Enum):
    """Date format preferences for ambiguous dates"""
    US = "us"      # MM/DD/YYYY
    EU = "eu"      # DD/MM/YYYY
    ISO = "iso"    # YYYY-MM-DD
    AUTO = "auto"  # Attempt to detect


@dataclass
class ParsedDate:
    """Result of date parsing"""
    date: datetime
    confidence: float  # 0.0 to 1.0
    original_text: str
    is_interview_date: bool = False
    is_post_date: bool = False
    timezone_info: Optional[str] = None
    is_range_start: bool = False
    is_range_end: bool = False
    ambiguous: bool = False
    format_detected: Optional[str] = None


@dataclass
class DateRange:
    """A date range extracted from text"""
    start: datetime
    end: datetime
    original_text: str
    confidence: float


# Relative date patterns for 15+ languages
RELATIVE_DATE_PATTERNS: Dict[str, Dict[str, Any]] = {
    # English
    'en': {
        'patterns': [
            (r'(\d+)\s*(?:seconds?|secs?|s)\s*ago', 'seconds'),
            (r'(\d+)\s*(?:minutes?|mins?|m)\s*ago', 'minutes'),
            (r'(\d+)\s*(?:hours?|hrs?|h)\s*ago', 'hours'),
            (r'(\d+)\s*(?:days?|d)\s*ago', 'days'),
            (r'(\d+)\s*(?:weeks?|wks?|w)\s*ago', 'weeks'),
            (r'(\d+)\s*(?:months?|mos?)\s*ago', 'months'),
            (r'(\d+)\s*(?:years?|yrs?|y)\s*ago', 'years'),
            (r'yesterday', 'yesterday'),
            (r'today', 'today'),
            (r'just\s*now', 'now'),
            (r'a\s*few\s*(?:seconds?|moments?)\s*ago', 'seconds_few'),
            (r'an?\s*hour\s*ago', 'hour'),
            (r'an?\s*day\s*ago', 'day'),
            (r'an?\s*week\s*ago', 'week'),
            (r'an?\s*month\s*ago', 'month'),
            (r'an?\s*year\s*ago', 'year'),
            (r'last\s*week', 'last_week'),
            (r'last\s*month', 'last_month'),
            (r'last\s*year', 'last_year'),
        ],
    },
    # Chinese (Simplified & Traditional)
    'zh': {
        'patterns': [
            (r'(\d+)\s*秒前', 'seconds'),
            (r'(\d+)\s*分[钟鐘]?前', 'minutes'),
            (r'(\d+)\s*[小时時]\s*前', 'hours'),
            (r'(\d+)\s*天前', 'days'),
            (r'(\d+)\s*[周週]前', 'weeks'),
            (r'(\d+)\s*[个個]?月前', 'months'),
            (r'(\d+)\s*年前', 'years'),
            (r'昨天', 'yesterday'),
            (r'今天', 'today'),
            (r'刚[刚才]', 'now'),
            (r'前天', 'day_before_yesterday'),
            (r'上[周週]', 'last_week'),
            (r'上[个個]?月', 'last_month'),
            (r'去年', 'last_year'),
        ],
    },
    # Japanese
    'ja': {
        'patterns': [
            (r'(\d+)\s*秒前', 'seconds'),
            (r'(\d+)\s*分前', 'minutes'),
            (r'(\d+)\s*時間前', 'hours'),
            (r'(\d+)\s*日前', 'days'),
            (r'(\d+)\s*週間前', 'weeks'),
            (r'(\d+)\s*[ヶか]?月前', 'months'),
            (r'(\d+)\s*年前', 'years'),
            (r'昨日', 'yesterday'),
            (r'今日', 'today'),
            (r'たった今', 'now'),
            (r'一昨日', 'day_before_yesterday'),
            (r'先週', 'last_week'),
            (r'先月', 'last_month'),
            (r'去年', 'last_year'),
        ],
    },
    # Korean
    'ko': {
        'patterns': [
            (r'(\d+)\s*초\s*전', 'seconds'),
            (r'(\d+)\s*분\s*전', 'minutes'),
            (r'(\d+)\s*시간\s*전', 'hours'),
            (r'(\d+)\s*일\s*전', 'days'),
            (r'(\d+)\s*주\s*전', 'weeks'),
            (r'(\d+)\s*[개]?월\s*전', 'months'),
            (r'(\d+)\s*년\s*전', 'years'),
            (r'어제', 'yesterday'),
            (r'오늘', 'today'),
            (r'방금', 'now'),
            (r'그저께', 'day_before_yesterday'),
            (r'지난\s*주', 'last_week'),
            (r'지난\s*달', 'last_month'),
            (r'작년', 'last_year'),
        ],
    },
    # Spanish
    'es': {
        'patterns': [
            (r'hace\s*(\d+)\s*segundos?', 'seconds'),
            (r'hace\s*(\d+)\s*minutos?', 'minutes'),
            (r'hace\s*(\d+)\s*horas?', 'hours'),
            (r'hace\s*(\d+)\s*d[íi]as?', 'days'),
            (r'hace\s*(\d+)\s*semanas?', 'weeks'),
            (r'hace\s*(\d+)\s*meses?', 'months'),
            (r'hace\s*(\d+)\s*a[ñn]os?', 'years'),
            (r'ayer', 'yesterday'),
            (r'hoy', 'today'),
            (r'ahora\s*mismo', 'now'),
            (r'anteayer', 'day_before_yesterday'),
            (r'la\s*semana\s*pasada', 'last_week'),
            (r'el\s*mes\s*pasado', 'last_month'),
            (r'el\s*a[ñn]o\s*pasado', 'last_year'),
        ],
    },
    # Portuguese
    'pt': {
        'patterns': [
            (r'h[áa]\s*(\d+)\s*segundos?', 'seconds'),
            (r'h[áa]\s*(\d+)\s*minutos?', 'minutes'),
            (r'h[áa]\s*(\d+)\s*horas?', 'hours'),
            (r'h[áa]\s*(\d+)\s*dias?', 'days'),
            (r'h[áa]\s*(\d+)\s*semanas?', 'weeks'),
            (r'h[áa]\s*(\d+)\s*meses?', 'months'),
            (r'h[áa]\s*(\d+)\s*anos?', 'years'),
            (r'ontem', 'yesterday'),
            (r'hoje', 'today'),
            (r'agora\s*mesmo', 'now'),
            (r'anteontem', 'day_before_yesterday'),
            (r'semana\s*passada', 'last_week'),
            (r'm[êe]s\s*passado', 'last_month'),
            (r'ano\s*passado', 'last_year'),
        ],
    },
    # German
    'de': {
        'patterns': [
            (r'vor\s*(\d+)\s*Sekunden?', 'seconds'),
            (r'vor\s*(\d+)\s*Minuten?', 'minutes'),
            (r'vor\s*(\d+)\s*Stunden?', 'hours'),
            (r'vor\s*(\d+)\s*Tagen?', 'days'),
            (r'vor\s*(\d+)\s*Wochen?', 'weeks'),
            (r'vor\s*(\d+)\s*Monaten?', 'months'),
            (r'vor\s*(\d+)\s*Jahren?', 'years'),
            (r'gestern', 'yesterday'),
            (r'heute', 'today'),
            (r'gerade\s*eben', 'now'),
            (r'vorgestern', 'day_before_yesterday'),
            (r'letzte\s*Woche', 'last_week'),
            (r'letzten?\s*Monat', 'last_month'),
            (r'letztes?\s*Jahr', 'last_year'),
        ],
    },
    # French
    'fr': {
        'patterns': [
            (r'il\s*y\s*a\s*(\d+)\s*secondes?', 'seconds'),
            (r'il\s*y\s*a\s*(\d+)\s*minutes?', 'minutes'),
            (r'il\s*y\s*a\s*(\d+)\s*heures?', 'hours'),
            (r'il\s*y\s*a\s*(\d+)\s*jours?', 'days'),
            (r'il\s*y\s*a\s*(\d+)\s*semaines?', 'weeks'),
            (r'il\s*y\s*a\s*(\d+)\s*mois', 'months'),
            (r'il\s*y\s*a\s*(\d+)\s*ans?', 'years'),
            (r'hier', 'yesterday'),
            (r"aujourd'hui", 'today'),
            (r'[àa]\s*l\'instant', 'now'),
            (r'avant-hier', 'day_before_yesterday'),
            (r'la\s*semaine\s*derni[èe]re', 'last_week'),
            (r'le\s*mois\s*dernier', 'last_month'),
            (r"l'ann[ée]e\s*derni[èe]re", 'last_year'),
        ],
    },
    # Russian
    'ru': {
        'patterns': [
            (r'(\d+)\s*секунд[уы]?\s*назад', 'seconds'),
            (r'(\d+)\s*минут[уы]?\s*назад', 'minutes'),
            (r'(\d+)\s*час(?:а|ов)?\s*назад', 'hours'),
            (r'(\d+)\s*(?:день|дня|дней)\s*назад', 'days'),
            (r'(\d+)\s*недел[ьиюя]\s*назад', 'weeks'),
            (r'(\d+)\s*месяц(?:а|ев)?\s*назад', 'months'),
            (r'(\d+)\s*(?:год|года|лет)\s*назад', 'years'),
            (r'вчера', 'yesterday'),
            (r'сегодня', 'today'),
            (r'только\s*что', 'now'),
            (r'позавчера', 'day_before_yesterday'),
            (r'на\s*прошлой\s*неделе', 'last_week'),
            (r'в\s*прошлом\s*месяце', 'last_month'),
            (r'в\s*прошлом\s*году', 'last_year'),
        ],
    },
    # Vietnamese
    'vi': {
        'patterns': [
            (r'(\d+)\s*gi[âa]y\s*tr[ưu][ớo]c', 'seconds'),
            (r'(\d+)\s*ph[úu]t\s*tr[ưu][ớo]c', 'minutes'),
            (r'(\d+)\s*gi[ờo]\s*tr[ưu][ớo]c', 'hours'),
            (r'(\d+)\s*ng[àa]y\s*tr[ưu][ớo]c', 'days'),
            (r'(\d+)\s*tu[ầa]n\s*tr[ưu][ớo]c', 'weeks'),
            (r'(\d+)\s*th[áa]ng\s*tr[ưu][ớo]c', 'months'),
            (r'(\d+)\s*n[ăa]m\s*tr[ưu][ớo]c', 'years'),
            (r'h[ôo]m\s*qua', 'yesterday'),
            (r'h[ôo]m\s*nay', 'today'),
            (r'v[ừu]a\s*xong', 'now'),
        ],
    },
    # Indonesian
    'id': {
        'patterns': [
            (r'(\d+)\s*detik\s*(?:yang\s*)?lalu', 'seconds'),
            (r'(\d+)\s*menit\s*(?:yang\s*)?lalu', 'minutes'),
            (r'(\d+)\s*jam\s*(?:yang\s*)?lalu', 'hours'),
            (r'(\d+)\s*hari\s*(?:yang\s*)?lalu', 'days'),
            (r'(\d+)\s*minggu\s*(?:yang\s*)?lalu', 'weeks'),
            (r'(\d+)\s*bulan\s*(?:yang\s*)?lalu', 'months'),
            (r'(\d+)\s*tahun\s*(?:yang\s*)?lalu', 'years'),
            (r'kemarin', 'yesterday'),
            (r'hari\s*ini', 'today'),
            (r'baru\s*saja', 'now'),
        ],
    },
    # Arabic
    'ar': {
        'patterns': [
            (r'منذ\s*(\d+)\s*ثواني?', 'seconds'),
            (r'منذ\s*(\d+)\s*دقائق?', 'minutes'),
            (r'منذ\s*(\d+)\s*ساعات?', 'hours'),
            (r'منذ\s*(\d+)\s*[اأ]يام?', 'days'),
            (r'منذ\s*(\d+)\s*[اأ]سابيع?', 'weeks'),
            (r'منذ\s*(\d+)\s*[اأ]شهر?', 'months'),
            (r'منذ\s*(\d+)\s*سنوات?', 'years'),
            (r'[اأ]مس', 'yesterday'),
            (r'اليوم', 'today'),
            (r'الآن', 'now'),
        ],
    },
    # Hindi
    'hi': {
        'patterns': [
            (r'(\d+)\s*सेकंड\s*पहले', 'seconds'),
            (r'(\d+)\s*मिनट\s*पहले', 'minutes'),
            (r'(\d+)\s*घंटे?\s*पहले', 'hours'),
            (r'(\d+)\s*दिन\s*पहले', 'days'),
            (r'(\d+)\s*हफ्ते?\s*पहले', 'weeks'),
            (r'(\d+)\s*महीने?\s*पहले', 'months'),
            (r'(\d+)\s*साल\s*पहले', 'years'),
            (r'कल', 'yesterday'),
            (r'आज', 'today'),
            (r'अभी', 'now'),
        ],
    },
    # Turkish
    'tr': {
        'patterns': [
            (r'(\d+)\s*saniye\s*[öo]nce', 'seconds'),
            (r'(\d+)\s*dakika\s*[öo]nce', 'minutes'),
            (r'(\d+)\s*saat\s*[öo]nce', 'hours'),
            (r'(\d+)\s*g[üu]n\s*[öo]nce', 'days'),
            (r'(\d+)\s*hafta\s*[öo]nce', 'weeks'),
            (r'(\d+)\s*ay\s*[öo]nce', 'months'),
            (r'(\d+)\s*y[ıi]l\s*[öo]nce', 'years'),
            (r'd[üu]n', 'yesterday'),
            (r'bug[üu]n', 'today'),
            (r'[şs]imdi', 'now'),
        ],
    },
    # Ukrainian
    'uk': {
        'patterns': [
            (r'(\d+)\s*секунд[иу]?\s*тому', 'seconds'),
            (r'(\d+)\s*хвилин[иу]?\s*тому', 'minutes'),
            (r'(\d+)\s*годин[иу]?\s*тому', 'hours'),
            (r'(\d+)\s*(?:день|дні|днів)\s*тому', 'days'),
            (r'(\d+)\s*тижн[івя]\s*тому', 'weeks'),
            (r'(\d+)\s*місяц[івя]\s*тому', 'months'),
            (r'(\d+)\s*рок[ів]\s*тому', 'years'),
            (r'вчора', 'yesterday'),
            (r'сьогодні', 'today'),
            (r'щойно', 'now'),
        ],
    },
    # Polish
    'pl': {
        'patterns': [
            (r'(\d+)\s*sekund[yę]?\s*temu', 'seconds'),
            (r'(\d+)\s*minut[yę]?\s*temu', 'minutes'),
            (r'(\d+)\s*godzin[yę]?\s*temu', 'hours'),
            (r'(\d+)\s*(?:dzień|dni)\s*temu', 'days'),
            (r'(\d+)\s*tygodni[eą]?\s*temu', 'weeks'),
            (r'(\d+)\s*miesi[ęą]c[eęy]?\s*temu', 'months'),
            (r'(\d+)\s*lat[a]?\s*temu', 'years'),
            (r'wczoraj', 'yesterday'),
            (r'dzi[śs]', 'today'),
            (r'przed\s*chwil[ąa]', 'now'),
        ],
    },
}

# Japanese era years (Wareki)
JAPANESE_ERAS = {
    '令和': (2019, 5, 1),   # Reiwa: May 1, 2019 - present
    '平成': (1989, 1, 8),   # Heisei: Jan 8, 1989 - Apr 30, 2019
    '昭和': (1926, 12, 25), # Showa: Dec 25, 1926 - Jan 7, 1989
    '大正': (1912, 7, 30),  # Taisho: Jul 30, 1912 - Dec 25, 1926
    '明治': (1868, 1, 25),  # Meiji: Jan 25, 1868 - Jul 30, 1912
}

# Month names in various languages
MONTH_NAMES = {
    'en': ['january', 'february', 'march', 'april', 'may', 'june',
           'july', 'august', 'september', 'october', 'november', 'december'],
    'es': ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
           'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    'fr': ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
           'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    'de': ['januar', 'februar', 'märz', 'april', 'mai', 'juni',
           'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
    'pt': ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
           'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    'ru': ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
           'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
    'tr': ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran',
           'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'],
}


class RelativeDateResolver:
    """Resolves relative date expressions to absolute dates"""

    def __init__(self, reference_date: Optional[datetime] = None):
        self.reference_date = reference_date or datetime.now(timezone.utc)

    def resolve(self, text: str, language: Optional[str] = None) -> Optional[ParsedDate]:
        """
        Resolve a relative date expression to an absolute date.

        Args:
            text: Text containing relative date expression
            language: Language code (auto-detect if None)

        Returns:
            ParsedDate if resolved, None otherwise
        """
        text_lower = text.lower().strip()

        # Try each language if not specified
        languages = [language] if language else list(RELATIVE_DATE_PATTERNS.keys())

        for lang in languages:
            if lang not in RELATIVE_DATE_PATTERNS:
                continue

            patterns = RELATIVE_DATE_PATTERNS[lang]['patterns']

            for pattern, time_type in patterns:
                match = re.search(pattern, text_lower if lang == 'en' else text, re.IGNORECASE)
                if match:
                    return self._calculate_date(match, time_type, text)

        return None

    def _calculate_date(self, match: re.Match, time_type: str, original_text: str) -> ParsedDate:
        """Calculate the absolute date from a relative expression"""
        now = self.reference_date

        # Handle named relative dates
        if time_type == 'yesterday':
            date = now - timedelta(days=1)
        elif time_type == 'today':
            date = now
        elif time_type == 'now':
            date = now
        elif time_type == 'day_before_yesterday':
            date = now - timedelta(days=2)
        elif time_type == 'last_week':
            date = now - timedelta(weeks=1)
        elif time_type == 'last_month':
            date = now - timedelta(days=30)
        elif time_type == 'last_year':
            date = now - timedelta(days=365)
        elif time_type == 'seconds_few':
            date = now - timedelta(seconds=30)
        elif time_type == 'hour':
            date = now - timedelta(hours=1)
        elif time_type == 'day':
            date = now - timedelta(days=1)
        elif time_type == 'week':
            date = now - timedelta(weeks=1)
        elif time_type == 'month':
            date = now - timedelta(days=30)
        elif time_type == 'year':
            date = now - timedelta(days=365)
        else:
            # Extract numeric value
            try:
                value = int(match.group(1))
            except (IndexError, ValueError):
                value = 1

            # Calculate offset
            if time_type == 'seconds':
                date = now - timedelta(seconds=value)
            elif time_type == 'minutes':
                date = now - timedelta(minutes=value)
            elif time_type == 'hours':
                date = now - timedelta(hours=value)
            elif time_type == 'days':
                date = now - timedelta(days=value)
            elif time_type == 'weeks':
                date = now - timedelta(weeks=value)
            elif time_type == 'months':
                date = now - timedelta(days=value * 30)
            elif time_type == 'years':
                date = now - timedelta(days=value * 365)
            else:
                date = now

        return ParsedDate(
            date=date,
            confidence=0.9,
            original_text=original_text,
            is_post_date=True,
            format_detected=f'relative_{time_type}'
        )


class UniversalDateParser:
    """
    Universal date parser supporting multiple formats and languages.
    """

    def __init__(self, default_format: DateFormat = DateFormat.AUTO,
                 default_timezone: Optional[str] = None):
        self.default_format = default_format
        self.default_timezone = default_timezone
        self.relative_resolver = RelativeDateResolver()

    def parse(self, text: str, language: Optional[str] = None,
              format_hint: Optional[DateFormat] = None) -> Optional[ParsedDate]:
        """
        Parse a date from text.

        Args:
            text: Text containing a date
            language: Language code for locale-specific parsing
            format_hint: Hint for ambiguous date formats

        Returns:
            ParsedDate if successful, None otherwise
        """
        if not text or not text.strip():
            return None

        text = text.strip()

        # Try relative dates first
        relative = self.relative_resolver.resolve(text, language)
        if relative:
            return relative

        # Try Japanese era dates
        japanese = self._parse_japanese_era(text)
        if japanese:
            return japanese

        # Try ISO format
        iso = self._parse_iso(text)
        if iso:
            return iso

        # Try locale-specific formats
        locale_result = self._parse_locale_specific(text, language)
        if locale_result:
            return locale_result

        # Try common formats with ambiguity resolution
        common = self._parse_common_formats(text, format_hint or self.default_format)
        if common:
            return common

        # Try extracting any date-like pattern
        extracted = self._extract_date_pattern(text)
        if extracted:
            return extracted

        return None

    def _parse_japanese_era(self, text: str) -> Optional[ParsedDate]:
        """Parse Japanese era dates (令和5年4月1日)"""
        for era_name, (base_year, base_month, base_day) in JAPANESE_ERAS.items():
            # Pattern: 令和5年4月1日 or 令和5年
            pattern = rf'{era_name}(\d+)年(?:(\d+)月)?(?:(\d+)日)?'
            match = re.search(pattern, text)
            if match:
                era_year = int(match.group(1))
                year = base_year + era_year - 1
                month = int(match.group(2)) if match.group(2) else 1
                day = int(match.group(3)) if match.group(3) else 1

                try:
                    date = datetime(year, month, day, tzinfo=timezone.utc)
                    return ParsedDate(
                        date=date,
                        confidence=0.95,
                        original_text=text,
                        format_detected=f'japanese_era_{era_name}'
                    )
                except ValueError:
                    continue

        return None

    def _parse_iso(self, text: str) -> Optional[ParsedDate]:
        """Parse ISO 8601 format dates"""
        # Full ISO with timezone
        iso_patterns = [
            (r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)?', 'iso_full'),
            (r'(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})', 'iso_datetime'),
            (r'(\d{4})-(\d{2})-(\d{2})', 'iso_date'),
            (r'(\d{4})/(\d{2})/(\d{2})', 'iso_slash'),
        ]

        for pattern, format_name in iso_patterns:
            match = re.search(pattern, text)
            if match:
                groups = match.groups()
                try:
                    year = int(groups[0])
                    month = int(groups[1])
                    day = int(groups[2])

                    hour = int(groups[3]) if len(groups) > 3 and groups[3] else 0
                    minute = int(groups[4]) if len(groups) > 4 and groups[4] else 0
                    second = int(groups[5]) if len(groups) > 5 and groups[5] else 0

                    date = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)

                    tz_info = None
                    if len(groups) > 6 and groups[6]:
                        tz_info = groups[6]

                    return ParsedDate(
                        date=date,
                        confidence=0.98,
                        original_text=text,
                        timezone_info=tz_info,
                        format_detected=format_name
                    )
                except ValueError:
                    continue

        return None

    def _parse_locale_specific(self, text: str, language: Optional[str]) -> Optional[ParsedDate]:
        """Parse locale-specific date formats"""
        text_lower = text.lower()

        # Try to find month names
        for lang, months in MONTH_NAMES.items():
            for i, month_name in enumerate(months, 1):
                if month_name in text_lower:
                    # Try to extract day and year
                    # Pattern: "January 15, 2024" or "15 January 2024" or "15 de enero de 2024"
                    patterns = [
                        rf'{month_name}\s+(\d{{1,2}}),?\s+(\d{{4}})',  # Month Day, Year
                        rf'(\d{{1,2}})\s+(?:de\s+)?{month_name}\s+(?:de\s+)?(\d{{4}})',  # Day Month Year
                        rf'(\d{{4}})\s+{month_name}\s+(\d{{1,2}})',  # Year Month Day
                    ]

                    for pattern in patterns:
                        match = re.search(pattern, text_lower)
                        if match:
                            groups = match.groups()
                            try:
                                if len(groups[0]) == 4:  # Year first
                                    year, day = int(groups[0]), int(groups[1])
                                elif len(groups[1]) == 4:  # Year second
                                    day, year = int(groups[0]), int(groups[1])
                                else:
                                    continue

                                date = datetime(year, i, day, tzinfo=timezone.utc)
                                return ParsedDate(
                                    date=date,
                                    confidence=0.9,
                                    original_text=text,
                                    format_detected=f'locale_{lang}'
                                )
                            except ValueError:
                                continue

        return None

    def _parse_common_formats(self, text: str, format_hint: DateFormat) -> Optional[ParsedDate]:
        """Parse common numeric date formats with ambiguity resolution"""
        # Numeric patterns
        patterns = [
            # DD/MM/YYYY or MM/DD/YYYY
            (r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})', 'dmy_or_mdy'),
            # YYYY/MM/DD
            (r'(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})', 'ymd'),
            # DD/MM/YY or MM/DD/YY
            (r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})', 'dmy_or_mdy_short'),
        ]

        for pattern, format_name in patterns:
            match = re.search(pattern, text)
            if match:
                groups = [int(g) for g in match.groups()]

                if format_name == 'ymd':
                    year, month, day = groups
                    ambiguous = False
                elif format_name in ['dmy_or_mdy', 'dmy_or_mdy_short']:
                    a, b, year = groups

                    # Convert 2-digit year
                    if year < 100:
                        year = 2000 + year if year < 50 else 1900 + year

                    # Determine which is day/month
                    ambiguous = (1 <= a <= 12) and (1 <= b <= 12) and (a != b)

                    if format_hint == DateFormat.US:
                        month, day = a, b
                    elif format_hint == DateFormat.EU:
                        day, month = a, b
                    else:
                        # Auto-detect: if one is > 12, it must be day
                        if a > 12:
                            day, month = a, b
                        elif b > 12:
                            month, day = a, b
                        else:
                            # Can't determine - use US format by default
                            month, day = a, b
                else:
                    continue

                try:
                    date = datetime(year, month, day, tzinfo=timezone.utc)
                    return ParsedDate(
                        date=date,
                        confidence=0.7 if ambiguous else 0.85,
                        original_text=text,
                        ambiguous=ambiguous,
                        format_detected=format_name
                    )
                except ValueError:
                    # Invalid date - try swapping day/month
                    try:
                        date = datetime(year, day, month, tzinfo=timezone.utc)
                        return ParsedDate(
                            date=date,
                            confidence=0.6,
                            original_text=text,
                            ambiguous=True,
                            format_detected=f'{format_name}_swapped'
                        )
                    except ValueError:
                        continue

        return None

    def _extract_date_pattern(self, text: str) -> Optional[ParsedDate]:
        """Extract any date-like pattern from text"""
        # Chinese date: 2024年4月15日
        chinese_match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', text)
        if chinese_match:
            try:
                year, month, day = [int(g) for g in chinese_match.groups()]
                date = datetime(year, month, day, tzinfo=timezone.utc)
                return ParsedDate(
                    date=date,
                    confidence=0.95,
                    original_text=text,
                    format_detected='chinese'
                )
            except ValueError:
                pass

        # Korean date: 2024년 4월 15일
        korean_match = re.search(r'(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일', text)
        if korean_match:
            try:
                year, month, day = [int(g) for g in korean_match.groups()]
                date = datetime(year, month, day, tzinfo=timezone.utc)
                return ParsedDate(
                    date=date,
                    confidence=0.95,
                    original_text=text,
                    format_detected='korean'
                )
            except ValueError:
                pass

        return None


class InterviewDateExtractor:
    """
    Extracts interview dates from text, distinguishing from post dates.
    """

    def __init__(self):
        self.parser = UniversalDateParser()

        # Interview date indicators in multiple languages
        self.interview_indicators = {
            'en': ['interviewed on', 'interview date', 'my interview was',
                   'i interviewed', 'had an interview on', 'interview scheduled for',
                   'onsite on', 'phone screen on', 'final round on'],
            'zh': ['面试日期', '面试时间', '在.*面试', '面试是在'],
            'ja': ['面接日', '面接は', '面接を受けた'],
            'ko': ['면접 날짜', '면접은', '면접을 봤'],
            'es': ['entrevista el', 'fecha de entrevista', 'mi entrevista fue'],
            'de': ['interview am', 'vorstellungsgespräch am', 'mein interview war'],
        }

        # Post date indicators
        self.post_indicators = {
            'en': ['posted on', 'written on', 'published', 'last updated',
                   'created at', 'submitted on'],
            'zh': ['发布于', '创建于', '更新于', '发表于'],
            'ja': ['投稿日', '作成日', '更新日'],
            'ko': ['작성일', '게시일', '등록일'],
        }

    def extract(self, text: str, language: Optional[str] = None) -> List[ParsedDate]:
        """
        Extract all dates from text, categorizing as interview or post dates.

        Args:
            text: Full text to analyze
            language: Language hint

        Returns:
            List of ParsedDate objects with is_interview_date/is_post_date flags
        """
        results = []

        # Split into sentences for context analysis
        sentences = re.split(r'[.!?。！？\n]', text)

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # Try to parse date from sentence
            parsed = self.parser.parse(sentence, language)
            if not parsed:
                continue

            # Determine if interview or post date
            sentence_lower = sentence.lower()

            is_interview = self._check_indicators(sentence_lower, self.interview_indicators, language)
            is_post = self._check_indicators(sentence_lower, self.post_indicators, language)

            parsed.is_interview_date = is_interview and not is_post
            parsed.is_post_date = is_post and not is_interview

            results.append(parsed)

        return results

    def _check_indicators(self, text: str, indicators: Dict[str, List[str]],
                          language: Optional[str] = None) -> bool:
        """Check if text contains any indicator phrases"""
        languages = [language] if language else list(indicators.keys())

        for lang in languages:
            if lang not in indicators:
                continue
            for indicator in indicators[lang]:
                if indicator.lower() in text:
                    return True

        return False

    def extract_interview_date(self, text: str, language: Optional[str] = None) -> Optional[ParsedDate]:
        """
        Extract the most likely interview date from text.

        Returns the highest-confidence interview date, or the most recent date
        if no explicit interview date is found.
        """
        all_dates = self.extract(text, language)

        if not all_dates:
            return None

        # Prefer explicitly marked interview dates
        interview_dates = [d for d in all_dates if d.is_interview_date]
        if interview_dates:
            return max(interview_dates, key=lambda d: d.confidence)

        # Otherwise return the most recent date
        return max(all_dates, key=lambda d: d.date)

    def extract_date_range(self, text: str) -> Optional[DateRange]:
        """
        Extract date ranges from text (e.g., "from January to March 2024")
        """
        # Common range patterns
        range_patterns = [
            # "from X to Y" / "X - Y" / "X ~ Y"
            (r'from\s+(.+?)\s+to\s+(.+?)(?:\s|$|\.)', 'en_from_to'),
            (r'(.+?)\s*[-–—~]\s*(.+?)(?:\s|$|\.)', 'dash_range'),
            (r'between\s+(.+?)\s+and\s+(.+?)(?:\s|$|\.)', 'en_between'),
            # Chinese: 从X到Y
            (r'从(.+?)到(.+?)(?:\s|$|。)', 'zh_from_to'),
            # Japanese: XからY
            (r'(.+?)から(.+?)まで', 'ja_from_to'),
        ]

        for pattern, range_type in range_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                start_text, end_text = match.groups()

                start_date = self.parser.parse(start_text)
                end_date = self.parser.parse(end_text)

                if start_date and end_date:
                    return DateRange(
                        start=start_date.date,
                        end=end_date.date,
                        original_text=match.group(0),
                        confidence=min(start_date.confidence, end_date.confidence)
                    )

        return None


def parse_date(text: str, language: Optional[str] = None,
               format_hint: Optional[DateFormat] = None) -> Optional[datetime]:
    """
    Convenience function to parse a date string.

    Args:
        text: Date string to parse
        language: Language code (optional)
        format_hint: DateFormat.US or DateFormat.EU for ambiguous dates

    Returns:
        datetime object or None
    """
    parser = UniversalDateParser(default_format=format_hint or DateFormat.AUTO)
    result = parser.parse(text, language, format_hint)
    return result.date if result else None


def extract_interview_date(text: str, language: Optional[str] = None) -> Optional[datetime]:
    """
    Convenience function to extract an interview date from text.

    Returns:
        datetime object representing the interview date, or None
    """
    extractor = InterviewDateExtractor()
    result = extractor.extract_interview_date(text, language)
    return result.date if result else None


def is_within_months(date: datetime, months: int = 5) -> bool:
    """
    Check if a date is within the last N months.

    Args:
        date: Date to check
        months: Number of months to look back

    Returns:
        True if date is within the specified period
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=months * 30)

    # Make date timezone-aware if it isn't
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)

    return date >= cutoff


# Module exports
__all__ = [
    'UniversalDateParser',
    'RelativeDateResolver',
    'InterviewDateExtractor',
    'ParsedDate',
    'DateRange',
    'DateFormat',
    'parse_date',
    'extract_interview_date',
    'is_within_months',
]
