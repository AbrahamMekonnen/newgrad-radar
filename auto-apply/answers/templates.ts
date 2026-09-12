/**
 * Answer Templates Module
 *
 * Pre-defined answer structures for 11 question categories.
 * Uses STAR format (Situation, Task, Action, Result) with variable placeholders
 * for runtime personalization.
 *
 * Variables: {company}, {role}, {product}, {team}, {experience}, {skill}, etc.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type AnswerLength = 'short' | 'standard' | 'long';

export type QuestionCategory =
  | 'why_company'
  | 'why_role'
  | 'challenging_project'
  | 'teamwork'
  | 'conflict_resolution'
  | 'failure_learning'
  | 'leadership'
  | 'problem_solving'
  | 'strengths'
  | 'weaknesses'
  | 'career_goals';

export interface LengthConfig {
  short: number;
  standard: number;
  long: number;
}

export interface AnswerExamples {
  short: string;
  standard: string;
  long: string;
}

export interface AnswerTemplate {
  /** STAR-format structure description */
  structure: string;
  /** Variables that can be interpolated at runtime */
  variables: string[];
  /** Target word counts for each length variant */
  lengths: LengthConfig;
  /** Example answers with placeholders */
  examples: AnswerExamples;
}

export interface AnswerTemplates {
  [category: string]: AnswerTemplate;
}

// ============================================================================
// Answer Templates
// ============================================================================

export const ANSWER_TEMPLATES: Record<QuestionCategory, AnswerTemplate> = {
  // ---------------------------------------------------------------------------
  // WHY COMPANY
  // ---------------------------------------------------------------------------
  why_company: {
    structure: 'hook + company_specific + personal_connection + contribution',
    variables: ['company', 'product', 'mission', 'recent_news', 'relevant_experience', 'role', 'timeline', 'value', 'culture_fit'],
    lengths: {
      short: 75,
      standard: 150,
      long: 300,
    },
    examples: {
      short: `I've been following {company}'s work on {product}, and the approach to {mission} aligns with what I care about. My experience with {relevant_experience} would let me contribute from day one.`,

      standard: `I've been following {company}'s work on {product} since {timeline}. What stands out is the commitment to {value} - it shows in how the team approaches {mission}. My background in {relevant_experience} connects directly to what this {role} requires. I want to contribute to building {product} and grow as an engineer at a company that {culture_fit}. The technical challenges here, especially around {technical_challenge}, are exactly what I want to work on.`,

      long: `I've been following {company} since {timeline}, particularly the work on {product}. What drew me in was {specific_observation} - it showed me that {company} takes {value} seriously, not just as a talking point. As someone who has worked on {relevant_experience}, I understand the complexity of {problem_domain} and why getting it right matters.

{personal_connection_story}

The {role} role excites me because {role_specific_interest}. My experience with {technical_skills} has prepared me for the challenges in {job_requirements}. I've shipped {achievement_metric} and learned how to balance speed with quality.

I'm drawn to {company}'s approach to {company_value}. I want to be part of building {future_vision}, and I believe I can contribute meaningfully while growing alongside the team.`,
    },
  },

  // ---------------------------------------------------------------------------
  // WHY ROLE
  // ---------------------------------------------------------------------------
  why_role: {
    structure: 'interest_hook + skills_match + growth_potential + impact',
    variables: ['role', 'company', 'skill', 'experience', 'technology', 'team', 'growth_area', 'impact'],
    lengths: {
      short: 75,
      standard: 150,
      long: 300,
    },
    examples: {
      short: `This {role} role combines my experience in {experience} with the chance to work on {technology}. I'm excited to join {team} and contribute to {impact} while deepening my skills in {growth_area}.`,

      standard: `This {role} position is a strong match for where I want to take my career. I've spent the past {timeline} building {experience}, and I'm ready to apply those skills in a production environment at {company}. What excites me most is working on {technology} - it's something I've explored in personal projects but want to do at scale. The chance to join {team} and learn from experienced engineers while contributing to {impact} is exactly what I'm looking for. I see this as an opportunity to grow in {growth_area} while bringing value from day one.`,

      long: `This {role} position stands out because it sits at the intersection of my skills and my ambitions. Over the past {timeline}, I've built a foundation in {experience}, working on projects that taught me {key_learning}. Now I want to apply that in a team that builds at scale.

What drew me to this role specifically is {role_specific_detail}. I've worked with {technology} in {project_context}, and I'm eager to see how {company} approaches {technical_challenge}. The problems this team tackles - {problem_examples} - are the kind I find genuinely interesting.

I'm also thinking about growth. The {role} role offers exposure to {growth_opportunities}, which aligns with my goal of becoming {career_target}. I want to contribute to {impact} while learning from {team}. My background in {skill} means I can start contributing quickly, and my curiosity about {learning_interest} means I'll keep pushing to get better.`,
    },
  },

  // ---------------------------------------------------------------------------
  // CHALLENGING PROJECT
  // ---------------------------------------------------------------------------
  challenging_project: {
    structure: 'STAR: situation + task + actions + results + learning',
    variables: ['project_name', 'context', 'organization', 'challenge', 'actions', 'metrics', 'technologies', 'lesson'],
    lengths: {
      short: 75,
      standard: 200,
      long: 350,
    },
    examples: {
      short: `At {organization}, I tackled {challenge} when building {project_name}. I {primary_action}, which resulted in {primary_metric}. This taught me {lesson} and strengthened my skills in {technologies}.`,

      standard: `During my time at {organization}, I worked on {project_name} where we faced {challenge}. The existing approach {problem_description}, and it was affecting {impact_description}.

I took ownership of the problem. First, I {action_1} to understand what was actually happening. Then I {action_2}, building a proof-of-concept in {timeline}. After getting buy-in from the team, I {action_3}.

The results: {primary_metric}. We also saw {secondary_metric}. This project taught me {lesson} - something I've applied to every technical decision since.`,

      long: `At {organization}, I worked on {project_name}, a {project_description}. About halfway through, we hit a significant challenge: {detailed_challenge}.

The situation was {situation_context}. Our users were experiencing {user_impact}, and the team was spending {resource_drain}. My task was to {task_description}.

I started by {analysis_approach}. What I found was {root_cause_discovery}. Based on this, I proposed {proposed_solution}. The approach wasn't obvious - {why_non_obvious} - but I was able to convince the team by {persuasion_method}.

Implementation took {timeline}. I {technical_action_1}, which required learning {new_skill}. Then I {technical_action_2}, making sure to {quality_consideration}. The hardest part was {main_difficulty}, which I solved by {difficulty_solution}.

The outcome exceeded what we hoped for. {primary_metric}. Beyond the numbers, {qualitative_impact}. The team adopted {lasting_change} as standard practice.

This project taught me {key_lesson}. I learned that {broader_insight}. It also showed me that {personal_growth_insight}. These lessons have shaped how I approach {application_domain} ever since.`,
    },
  },

  // ---------------------------------------------------------------------------
  // TEAMWORK
  // ---------------------------------------------------------------------------
  teamwork: {
    structure: 'context + role + collaboration + outcome',
    variables: ['project', 'team_size', 'your_role', 'collaboration_style', 'organization', 'outcome', 'lesson'],
    lengths: {
      short: 75,
      standard: 150,
      long: 250,
    },
    examples: {
      short: `On {project} at {organization}, I worked with a {team_size}-person team as {your_role}. I contributed by {collaboration_style}, and together we delivered {outcome}. I learned {lesson} from this experience.`,

      standard: `At {organization}, I was part of a {team_size}-person team building {project}. My role was {your_role}, but the work required constant collaboration across {team_composition}.

What made this team effective was {team_strength}. I contributed by {specific_contribution} - for example, {contribution_example}. When we hit {challenge}, I {collaboration_action} with {collaborator_role} to find a solution.

We shipped {outcome} in {timeline}. More importantly, I learned {lesson}. The experience showed me that {broader_insight} is key to working well with others.`,

      long: `One of my best teamwork experiences was {project} at {organization}. We had {team_size} people with different backgrounds: {team_composition_detail}. I served as {your_role}.

The project goal was {project_goal}. Early on, we faced {early_challenge} - our initial approach {what_went_wrong}. This is where collaboration became critical. I {collaboration_initiative}, suggesting we {proposed_process}.

My specific contributions included {contribution_list}. But what I'm proudest of is how I helped the team work better together. When {conflict_or_challenge} happened, I {facilitation_action}. I also made a point to {supportive_behavior}, which {positive_effect}.

We delivered {detailed_outcome}. The project {impact_description}. Feedback from {stakeholder} mentioned {specific_feedback}.

This experience taught me that effective teamwork isn't just about dividing tasks - it's about {teamwork_insight}. I learned to {skill_gained}, and I've carried that into every team since. When I think about what makes teams succeed, I always come back to {key_principle}.`,
    },
  },

  // ---------------------------------------------------------------------------
  // CONFLICT RESOLUTION
  // ---------------------------------------------------------------------------
  conflict_resolution: {
    structure: 'situation + approach + resolution + relationship_outcome',
    variables: ['context', 'disagreement', 'other_party', 'approach', 'resolution', 'relationship_outcome', 'lesson'],
    lengths: {
      short: 75,
      standard: 150,
      long: 250,
    },
    examples: {
      short: `During {context}, {other_party} and I disagreed about {disagreement}. I {approach} by listening to their perspective and proposing {resolution}. We ended up {relationship_outcome}, and I learned {lesson}.`,

      standard: `While working on {context} at {organization}, I had a disagreement with {other_party} about {disagreement}. They believed {their_position}, while I thought {your_position}. The tension was affecting {impact_on_work}.

Instead of pushing harder, I asked to talk one-on-one. I started by genuinely listening - {what_you_learned_from_them}. Then I explained my reasoning: {your_reasoning}. We realized {common_ground_discovery}.

We agreed on {resolution}. The outcome was {concrete_result}. More importantly, {relationship_outcome}. This taught me that {lesson} - disagreements often come from {insight_about_conflict}.`,

      long: `At {organization}, I worked closely with {other_party} on {project_context}. Midway through, we disagreed strongly about {detailed_disagreement}.

The situation was {situation_details}. {other_party} felt that {their_full_position}, backed by {their_reasoning}. I believed {your_full_position} because {your_reasoning}. Neither of us was budging, and it was starting to {negative_impact}.

I realized that arguing more wasn't going to help. Instead, I {initial_action}. I asked {other_party} to walk me through their thinking in detail. What I learned was {insight_gained} - they had context I didn't about {context_gap}.

With that understanding, I {next_action}. I acknowledged that {acknowledgment} and proposed {proposed_solution}. The key was {why_solution_worked}.

We went with {final_decision}. The result: {concrete_outcome}. But what mattered more was {relationship_change}. {other_party} and I {new_working_dynamic}. They later {positive_indicator}.

This experience changed how I approach disagreements. I learned that {key_lesson}. Now when I sense conflict brewing, I {new_habit}. It's not about avoiding disagreement - it's about {conflict_philosophy}.`,
    },
  },

  // ---------------------------------------------------------------------------
  // FAILURE / LEARNING
  // ---------------------------------------------------------------------------
  failure_learning: {
    structure: 'mistake + impact + response + learning + application',
    variables: ['failure', 'context', 'consequence', 'recovery_action', 'lesson', 'application'],
    lengths: {
      short: 75,
      standard: 200,
      long: 300,
    },
    examples: {
      short: `During {context}, I {failure}. This led to {consequence}. I responded by {recovery_action} and learned to {lesson}. Since then, I've applied this by {application}.`,

      standard: `At {organization}, I made a mistake that taught me an important lesson. While working on {context}, I {failure}. I had assumed {faulty_assumption}, and I didn't {missing_step}.

The consequence was {consequence}. It affected {who_was_affected} and meant {additional_impact}. I felt {emotional_response}, but I knew I had to fix it.

First, I {immediate_action}. Then I {follow_up_action} to prevent the same thing from happening again. I also {accountability_action} with {stakeholder}.

What I learned: {lesson}. The failure happened because {root_cause_insight}. Now I always {new_habit}. When I joined {next_context}, I applied this by {specific_application}. It's shaped how I {broader_behavior}.`,

      long: `One of the most valuable lessons I've learned came from a failure at {organization}. I was working on {project_context}, feeling confident because {confidence_reason}.

The mistake I made was {detailed_failure}. Specifically, I {specific_error}. I had assumed {assumption_1} and {assumption_2}. What I didn't account for was {blind_spot}.

The consequences hit quickly. {immediate_consequence}. This caused {downstream_impact}. {affected_parties} were {effect_on_others}. I remember feeling {emotional_response}, but there wasn't time to dwell on it.

My response had three parts. First, I {triage_action} - {triage_details}. Then I {fix_action}, which took {fix_timeline}. Finally, I {prevention_action} so we wouldn't face this again. I also made sure to {communication_action} with {stakeholders}.

The situation was resolved in {resolution_timeline}. {final_outcome}. But the real value was the lesson.

I learned {primary_lesson}. Before this, I thought {old_belief}. Now I understand that {new_understanding}. The failure forced me to develop {new_skill_or_habit}.

I've applied this in {application_contexts}. When I {situation_trigger}, I now {new_behavior}. At {later_context}, this helped me {positive_outcome}. What felt like a setback became one of the most important experiences in my development as an engineer.`,
    },
  },

  // ---------------------------------------------------------------------------
  // LEADERSHIP
  // ---------------------------------------------------------------------------
  leadership: {
    structure: 'context + challenge + leadership_actions + team_outcome',
    variables: ['scope', 'situation', 'team', 'actions', 'impact', 'organization', 'lesson'],
    lengths: {
      short: 75,
      standard: 200,
      long: 300,
    },
    examples: {
      short: `As {scope} at {organization}, I led {team} through {situation}. I {primary_action}, which resulted in {impact}. This taught me {lesson} about leading effectively.`,

      standard: `At {organization}, I stepped into a leadership role when {situation_trigger}. I was {scope}, working with {team_description}.

The challenge was {challenge}. The team was {team_state}, and we needed to {goal}. I started by {first_action} - understanding {what_you_assessed}. Then I {second_action}, making sure to {consideration}.

My approach focused on {leadership_philosophy}. For example, when {specific_situation}, I {specific_action}. I also {supportive_action} to help team members {team_benefit}.

The outcome: {quantitative_result}. Beyond that, {qualitative_result}. Feedback from {feedback_source} included {specific_feedback}. This experience taught me that leadership is about {lesson}.`,

      long: `During {context} at {organization}, I had the opportunity to lead {team_description} through {detailed_situation}.

The situation was {situation_background}. When I took on the {scope} role, {initial_challenge}. The team {team_state}, and there was {additional_pressure}.

My first priority was {priority_1}. I {action_1}, which {action_1_outcome}. Then I focused on {priority_2}. This meant {action_2}, even when {difficulty_with_action_2}. The key was {key_insight}.

I also made decisions that weren't popular but were necessary. For instance, {tough_decision}. I explained {rationale} and made sure to {supportive_measure}. Over time, {how_team_responded}.

One moment stands out: {pivotal_moment}. I {pivotal_action}, and it {pivotal_outcome}. This showed me {pivotal_lesson}.

The results spoke for themselves. {primary_outcome}. We also {secondary_outcome}. Team members {team_member_feedback}. {stakeholder} noted that {stakeholder_feedback}.

Leadership, I learned, isn't about having all the answers. It's about {leadership_definition}. The experience shaped my approach to {leadership_area}. I now believe that {leadership_philosophy}, and I try to {ongoing_practice} in every team I'm part of.`,
    },
  },

  // ---------------------------------------------------------------------------
  // PROBLEM SOLVING
  // ---------------------------------------------------------------------------
  problem_solving: {
    structure: 'problem + analysis + solution + result',
    variables: ['problem', 'context', 'approach', 'solution', 'outcome', 'technologies', 'lesson'],
    lengths: {
      short: 75,
      standard: 200,
      long: 300,
    },
    examples: {
      short: `At {organization}, I encountered {problem} while working on {context}. I {approach}, implemented {solution}, and achieved {outcome}. This reinforced my belief in {lesson}.`,

      standard: `While working on {context} at {organization}, I ran into {problem}. The system was {problem_symptoms}, and {affected_users_or_systems} were {impact}.

My approach: first, {analysis_step_1}. This revealed {finding_1}. Then I {analysis_step_2} and found {finding_2}. The root cause was {root_cause}.

For the solution, I {solution_approach}. I chose this because {reasoning}. Implementation involved {implementation_details}, and I made sure to {quality_step}. Testing confirmed {testing_result}.

The outcome: {quantitative_result}. {qualitative_result}. This experience reinforced {lesson} and improved my skills in {skill_area}.`,

      long: `At {organization}, I faced a challenging problem while working on {project_context}. The issue was {detailed_problem_description}.

The symptoms appeared as {symptom_list}. Users were experiencing {user_impact}, and the team had tried {previous_attempts} without success. I was asked to {your_assignment}.

My approach started with {methodology}. I {step_1}, gathering {data_collected}. Analyzing this data, I noticed {pattern_or_insight}. Then I {step_2}, which revealed {deeper_finding}. The investigation took {timeline} and involved {tools_or_techniques}.

The root cause turned out to be {root_cause_detail}. It wasn't obvious because {why_non_obvious}. Once I understood the problem, I designed a solution that {solution_approach}.

Implementation had several phases. First, {implementation_phase_1}. Then {implementation_phase_2}. The trickiest part was {challenge_in_implementation}, which I handled by {how_you_handled_it}. I validated the fix through {validation_method}.

Results: {primary_metric}. Beyond the fix, {additional_benefit}. The solution also {lasting_impact}. {stakeholder_response}.

This problem taught me {primary_lesson}. I developed a better approach to {skill_improved}, and I now {new_habit_or_practice}. When I encounter {similar_situations}, I apply {methodology_learned}.`,
    },
  },

  // ---------------------------------------------------------------------------
  // STRENGTHS
  // ---------------------------------------------------------------------------
  strengths: {
    structure: 'strength + evidence + relevance_to_role',
    variables: ['strength', 'example', 'context', 'result', 'role', 'application'],
    lengths: {
      short: 50,
      standard: 100,
      long: 200,
    },
    examples: {
      short: `My greatest strength is {strength}. At {context}, I {example}, which led to {result}. I'd bring this to {role} by {application}.`,

      standard: `My greatest strength is {strength}. I've seen this make a difference in {context}, where I {detailed_example}. The result was {result}. Colleagues have noted that I {colleague_observation}.

For this {role} position, this means {relevance}. I'd apply it by {specific_application}, helping the team {team_benefit}.`,

      long: `My greatest strength is {strength}. It's something I've deliberately developed because {why_important_to_you}.

A clear example: at {organization}, I {situation_setup}. The challenge was {challenge}. I applied {strength} by {specific_actions}. For instance, {detailed_instance}. The outcome was {quantitative_result} and {qualitative_result}.

Colleagues and managers have reinforced this. {feedback_source} mentioned that I {specific_feedback}. In performance reviews, {review_mention}.

For this {role} role, {strength} translates directly to {job_requirement}. I would {application_1}, ensuring {benefit_1}. I'd also {application_2}, which matters because {why_it_matters}. The team would gain {team_benefit}.

This strength pairs with my commitment to {complementary_quality}, making me effective at {combined_strength_outcome}.`,
    },
  },

  // ---------------------------------------------------------------------------
  // WEAKNESSES
  // ---------------------------------------------------------------------------
  weaknesses: {
    structure: 'weakness + awareness + improvement_actions + progress',
    variables: ['weakness', 'impact', 'improvement_action', 'progress', 'ongoing_practice'],
    lengths: {
      short: 50,
      standard: 100,
      long: 200,
    },
    examples: {
      short: `An area I'm working on is {weakness}. I've addressed this by {improvement_action}, and I've seen {progress}. I continue to {ongoing_practice}.`,

      standard: `An area I'm actively improving is {weakness}. Earlier in my career, this showed up as {early_manifestation}. I realized it was holding me back when {awareness_moment}.

I've taken concrete steps: {improvement_action_1} and {improvement_action_2}. The progress has been {progress_description}. Recently, {recent_example} showed me I'm on the right track.

I continue to {ongoing_practice}. It's an ongoing effort, but I'm committed to {commitment_statement}.`,

      long: `An area I'm actively working to improve is {weakness}. I want to be honest about this because growth matters to me.

Earlier, this showed up as {early_manifestation}. At {context}, it led to {specific_consequence}. The turning point was {awareness_moment} - I realized {realization}.

Since then, I've taken deliberate action. First, {improvement_action_1}. This helped me {benefit_1}. I also {improvement_action_2}, which taught me {learning_2}. When possible, I {improvement_action_3}.

The progress has been meaningful. {progress_example_1}. Where I used to {old_behavior}, I now {new_behavior}. {feedback_source} noticed that {observed_change}.

I'm not done improving. I still {remaining_challenge}. My ongoing practices include {ongoing_practice_1} and {ongoing_practice_2}. I've set {specific_goal} as my next milestone.

What this weakness has taught me is {meta_lesson}. I believe the willingness to confront areas for growth is itself a strength. For this role, I'd bring {what_you_bring} - including the self-awareness to keep getting better.`,
    },
  },

  // ---------------------------------------------------------------------------
  // CAREER GOALS
  // ---------------------------------------------------------------------------
  career_goals: {
    structure: 'current_position + growth_areas + long_term_vision + company_fit',
    variables: ['current_stage', 'learning_goals', 'future_role', 'company', 'role', 'timeline'],
    lengths: {
      short: 75,
      standard: 150,
      long: 250,
    },
    examples: {
      short: `I'm currently {current_stage}, focused on deepening my skills in {learning_goals}. In {timeline}, I see myself as {future_role}. {company} offers the environment to grow in this direction through {role}.`,

      standard: `Right now, I'm at {current_stage} in my career, having built a foundation in {foundation_skills}. My near-term focus is {learning_goals} - I want to get significantly better at {specific_skill_area}.

Looking ahead {timeline}, I see myself as {future_role}. This means {what_future_role_means}. I'm drawn to {interest_area} and want to make an impact in {impact_area}.

{company} fits this trajectory because {company_fit_reason}. The {role} position offers {opportunity_description}. I'd grow by {growth_pathway} while contributing {contribution}.`,

      long: `I think about my career in phases. Currently, I'm at {current_stage}, with experience in {experience_areas}. I've learned {key_learnings}, and I've identified {identified_gaps} as areas to strengthen.

In the next {short_term_timeline}, my goal is {short_term_goal}. This means {short_term_details}. I want to work on {project_types} and learn from {learning_sources}. Specifically, I'm focused on {specific_focus_areas}.

Looking further ahead, {long_term_timeline}, I envision myself as {future_role}. This role would involve {future_role_responsibilities}. I'm drawn to this path because {motivation}. The impact I want to have is {desired_impact}.

{company} aligns with these goals in several ways. First, {alignment_1}. Second, {alignment_2}. The {role} position specifically offers {role_opportunity}, which maps directly to {how_it_maps_to_goals}.

I know career paths aren't linear. I'm open to {flexibility_statement}. What matters is {core_value} - that's the thread I want running through whatever I do. I'd bring {what_you_bring} to {company} while learning {what_you'd_learn}.`,
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a template by category and length
 */
export function getTemplate(
  category: QuestionCategory,
  length: AnswerLength = 'standard'
): string | null {
  const template = ANSWER_TEMPLATES[category];
  if (!template) return null;
  return template.examples[length] || template.examples.standard;
}

/**
 * Get target word count for a category and length
 */
export function getTargetWordCount(
  category: QuestionCategory,
  length: AnswerLength
): number {
  const template = ANSWER_TEMPLATES[category];
  if (!template) return 150; // default
  return template.lengths[length];
}

/**
 * Get all variables used in a template
 */
export function getTemplateVariables(category: QuestionCategory): string[] {
  const template = ANSWER_TEMPLATES[category];
  return template?.variables || [];
}

/**
 * Get the structure description for a category
 */
export function getTemplateStructure(category: QuestionCategory): string {
  const template = ANSWER_TEMPLATES[category];
  return template?.structure || '';
}

/**
 * List all available categories
 */
export function getAllCategories(): QuestionCategory[] {
  return Object.keys(ANSWER_TEMPLATES) as QuestionCategory[];
}

/**
 * Check if a category exists
 */
export function isValidCategory(category: string): category is QuestionCategory {
  return category in ANSWER_TEMPLATES;
}

// ============================================================================
// Exports
// ============================================================================

export default ANSWER_TEMPLATES;
