import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, TOPIC_IDS, topicLabel } from '../../assets/lib/topics.js';

test('the thirteen topic ids from the spec, in order', () => {
  assert.deepEqual([...TOPIC_IDS], ['ai', 'data', 'software', 'webmobile', 'cyber', 'cloud', 'startups', 'fintech', 'iot', 'games', 'green', 'careers', 'policy']);
  assert.deepEqual(TOPICS.map(t => t.id), [...TOPIC_IDS]);
});

test('every topic has an English label, an Arabic label and an icon name', () => {
  for (const t of TOPICS) {
    assert.ok(t.en.length > 2, t.id);
    assert.match(t.ar, /\p{Script=Arabic}/u, `${t.id} has Arabic text`);
    assert.match(t.icon, /^[a-z]+$/, t.id);
  }
  assert.equal(new Set(TOPICS.map(t => t.icon)).size, TOPICS.length, 'icons are distinct');
});

test('topicLabel gives the label in the language and returns unknown ids unchanged', () => {
  assert.equal(topicLabel('cyber', 'en'), 'Cybersecurity');
  assert.equal(topicLabel('cyber', 'ar'), 'الأمن السيبراني');
  assert.equal(topicLabel('ai'), 'AI & machine learning');
  assert.equal(topicLabel('mystery', 'en'), 'mystery');
  assert.equal(topicLabel(undefined, 'en'), '');
});

test('the lists cannot be changed by callers', () => {
  assert.throws(() => TOPIC_IDS.push('x'));
  assert.throws(() => { TOPICS[0].en = 'changed'; });
});
