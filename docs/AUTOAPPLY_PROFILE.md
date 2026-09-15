# Auto-Apply — What We Collect at Signup

Working notes for the auto-apply onboarding. Goal: collect **enough** about the
user, once, that we can fill any ATS form **deterministically** for ~80% of
fields and let AI draft the rest with real context — so we never guess and never
send a bad application. Derived from the real form-sampling study
(`scraper/autoapply/form_sampler.py`): Greenhouse forms average ~15 fields, only
~2.75 need AI; the rest are the fields below.

Legend: **[core]** = always required to apply anywhere · **[common]** = asked on
most forms · **[rich]** = powers AI answers + tailoring · **[eeo]** = optional,
default to "decline to answer".

---

## 1. Identity & contact — [core]
- First name, Last name — legal name (Greenhouse/GH split these; Lever uses one "name")
- Preferred name — [common]
- Pronouns — [eeo]
- Email — [core]
- Phone (with country) — [core]
- Location: city, state/region, country, postal code — [common] (some forms split these)

## 2. Links — [common]
- LinkedIn URL
- GitHub URL
- Portfolio / personal website
- Other (Twitter/X, Behance, Google Scholar) — free-form list

## 3. Resume & documents — [core]
- Resume file (PDF preferred; store in Supabase Storage)
- **Parsed, structured resume** (we parse the PDF into JSON) — critical: many
  fields (experience, education, skills) and all AI answers come from this
- Cover letter: none by default; AI generates per job — [rich]
- Transcript / writing sample — [rare], only if a form asks; prompt on demand

## 4. Work authorization — [core]
These gate most tech applications, so ask explicitly (don't infer):
- Are you authorized to work in the US? (yes/no)
- Will you now or in the future require visa sponsorship? (yes/no)
- Current visa status (US citizen / green card / F-1 OPT / H-1B / other) — [common]
- (Non-US boards) equivalents per country

## 5. Availability & logistics — [common]
- Earliest start date (immediately / 2 weeks / 1 month / specific date)
- Notice period
- Willing to relocate? (yes/no + preferred locations)
- Open to remote / hybrid / onsite
- Desired/expected salary (number or range; some forms require it)

## 6. Experience & education — [rich]
Ask for real history so AI answers are grounded, not invented:
- **Work experience** (repeatable): company, title, start/end, location,
  3–5 bullet achievements each
- Total years of experience (derived, but confirm)
- Current/most recent title & company
- **Education** (repeatable): school, degree, major, GPA (optional), grad month/year
- Skills (tags) + proficiency
- Certifications / licenses — [common on some]

## 7. Story bank — [rich] (this is the AI fuel)
Short reusable answers the AI draws on for open-ended questions so it never
makes things up. Collect 5–10 during onboarding, grow over time:
- "Why are you interested in this role/company?" (template + per-company AI)
- "Tell us about a project you're proud of"
- Biggest strengths / an area you're improving
- A challenge you overcame (behavioral / STAR)
- What you're looking for in your next role
- Values / what motivates you
- Preferred work style
We already have a `user_story_bank` table + StoryBankWizard — reuse and expand it.

## 8. Demographics / EEO — [eeo] (optional, default "decline")
Never required to submit; always offer "decline to answer" as the default:
- Gender, Race/Ethnicity, Hispanic/Latino, Veteran status, Disability status
Store the user's choice once; reuse everywhere. Default every one to decline
unless the user opts in.

## 9. Screening & referral defaults — [common]
- "How did you hear about us?" default (e.g. "Company website" / "LinkedIn")
- Have you worked here before? (default no)
- Are you 18+ ? (yes)
- Referral name (blank unless provided)

## 10. Custom-answer memory — [rich, grows over time]
A learned `question -> answer` map (`custom_answers` JSONB, already in schema).
When a form asks something new and free-text:
1. Check custom-answer memory / story bank for a match (fuzzy).
2. If none, AI drafts using resume + story bank.
3. Save the (question, answer) so next time it's deterministic — the user's
   "history" compounds; over time almost nothing needs a fresh AI call.

---

## How much to ask per ATS (so we don't over- or under-collect)
| Field group | Greenhouse | Lever | Ashby | Workday |
|---|---|---|---|---|
| Identity + email + phone | ✅ | ✅ | ✅ | ✅ |
| Resume upload | ✅ | ✅ | ✅ | ✅ |
| Links (LinkedIn/GitHub/portfolio) | ✅ | ✅ (`urls[...]`) | ✅ | ✅ |
| Work auth / sponsorship | ✅ common | varies | ✅ common | ✅ |
| Demographics/EEO | ✅ (optional) | ✅ | ✅ | ✅ |
| Custom free-text Qs | some | `cards[...]` | some | many |
| Account creation / login | ❌ | ❌ | ❌ | ✅ (blocker) |

## Onboarding UX principle
Front-load the **[core]** + **[common]** fields (a ~5-minute form + resume
upload gets us applying immediately), then progressively collect **[rich]**
history and story-bank answers — including learning from the first few real
applications — so quality climbs the more the user uses it. Ask a lot, but
spread it out; never block the first application on the long tail.
