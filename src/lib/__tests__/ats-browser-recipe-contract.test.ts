/* eslint-disable @typescript-eslint/no-require-imports */
import { ATS_REGISTRY } from '../ats-registry';

const generated = require('../../../extension/ats-recipes.js');
const manifest = require('../../../extension/manifest.json');

const representativeUrls: Record<string, string> = {
  greenhouse: 'https://job-boards.greenhouse.io/acme/jobs/123',
  lever: 'https://jobs.lever.co/acme/123',
  ashby: 'https://jobs.ashbyhq.com/acme/123',
  workday: 'https://acme.wd1.myworkdayjobs.com/jobs/123',
  smartrecruiters: 'https://jobs.smartrecruiters.com/acme/123',
  icims: 'https://acme.icims.com/jobs/123',
  taleo: 'https://acme.taleo.net/careersection/jobdetail.ftl',
  bamboohr: 'https://acme.bamboohr.com/careers/123',
  breezyhr: 'https://acme.breezy.hr/p/123',
  jazzhr: 'https://acme.applytojob.com/apply/123',
  recruitee: 'https://acme.recruitee.com/o/role',
  jobvite: 'https://jobs.jobvite.com/acme/job/123',
};

describe('generated browser ATS recipe contract', () => {
  const serverTypes = Object.keys(ATS_REGISTRY).filter((type) => type !== 'unknown').sort();

  it('stays synchronized with every supported server ATS', () => {
    expect(generated.recipes.map((recipe: { type: string }) => recipe.type).sort()).toEqual(serverTypes);
  });

  it.each(Object.entries(representativeUrls))('detects %s from a representative URL', (type, url) => {
    expect(generated.detect(url)?.type).toBe(type);
  });

  it('ships actionable form, field, and outcome recipes', () => {
    for (const recipe of generated.recipes) {
      expect(recipe.formSelectors.length).toBeGreaterThan(0);
      expect(recipe.submitSelectors.length).toBeGreaterThan(0);
      expect(recipe.successIndicators.length).toBeGreaterThan(0);
      expect(recipe.errorIndicators.length).toBeGreaterThan(0);
      expect(recipe.fieldMappings.length).toBeGreaterThan(0);
      expect(recipe.fieldMappings.some((field: { standard: string }) => field.standard === 'email')).toBe(true);
    }
  });

  it('loads recipes before browser adapters in every content-script frame', () => {
    const scripts = manifest.content_scripts[0].js;
    expect(scripts.indexOf('ats-recipes.js')).toBeGreaterThanOrEqual(0);
    expect(scripts.indexOf('ats-recipes.js')).toBeLessThan(scripts.indexOf('ats-adapters.js'));
    expect(manifest.content_scripts[0].all_frames).toBe(true);
  });
});