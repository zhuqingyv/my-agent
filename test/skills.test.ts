import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSkillCommand, loadSkillsFromDirectory } from '../src/skills/loadSkills.js';

test('loadSkillsFromDirectory: parses YAML frontmatter with argument lists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-skills-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'deploy.md'),
      `---
name: deploy
description: 部署项目到生产环境
arguments:
  - name: environment
    description: 部署环境
    required: false
    default: staging
---

deploy {{environment}}`
    );

    const skills = await loadSkillsFromDirectory(dir);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'deploy');
    assert.equal(skills[0].frontmatter.arguments?.[0].name, 'environment');

    const command = createSkillCommand(skills[0]);
    assert.equal(await command.handler('', {} as any), 'deploy staging');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
