import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexModelCatalog } from '../src/model-catalog.mjs';

test('builds a Codex catalog from production Responses models only', () => {
  const catalog = createCodexModelCatalog([
    {
      slug: 'openai/gpt-test',
      aliases: ['gpt-test'],
      name: 'OpenAI: GPT Test',
      description: 'Test model',
      suitable_api: 'chat.completions,responses',
      supports_reasoning: 1,
      context_length: 200000,
      input_modalities: 'text,image,file',
      output_modalities: 'text',
    },
    {
      slug: 'openai/chat-only',
      name: 'Chat only',
      suitable_api: 'chat.completions',
    },
  ]);

  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].slug, 'gpt-test');
  assert.deepEqual(catalog.models[0].input_modalities, ['text', 'image']);
  assert.equal(catalog.models[0].context_window, 200000);
  assert.equal(catalog.models[0].use_responses_lite, false);
  assert.equal(catalog.models[0].tool_mode, null);
  assert.equal(catalog.models[0].multi_agent_version, 'v2');
  assert.equal(catalog.models[0].support_verbosity, true);
  assert.equal(catalog.models[0].base_instructions.length > 0, true);
  assert.equal(
    catalog.models[0].base_instructions,
    catalog.models[0].model_messages.instructions_template,
  );
  assert.equal(catalog.models[0].model_messages.instructions_template.length > 0, true);
  assert.equal(catalog.models[0].apply_patch_tool_type, 'freeform');
});

test('does not inject a freeform patch tool for non-native model families', () => {
  const catalog = createCodexModelCatalog([{
    slug: 'deepseek/deepseek-test',
    name: 'DeepSeek Test',
    suitable_api: 'responses',
    supports_reasoning: 1,
    output_modalities: 'text',
  }]);
  assert.equal(catalog.models[0].apply_patch_tool_type, null);
  assert.equal(catalog.models[0].multi_agent_version, null);
  assert.equal('web_search_tool_type' in catalog.models[0], false);
  assert.equal(catalog.models[0].supports_search_tool, false);
});

test('places native GPT models first while preserving family order', () => {
  const catalog = createCodexModelCatalog([
    { slug: 'anthropic/claude-a', suitable_api: 'responses' },
    { slug: 'openai/gpt-b', aliases: ['gpt-b'], suitable_api: 'responses' },
    { slug: 'google/gemini-a', suitable_api: 'responses' },
    { slug: 'openai/gpt-a', aliases: ['gpt-a'], suitable_api: 'responses' },
  ]);

  assert.deepEqual(
    catalog.models.map(model => model.slug),
    ['gpt-b', 'gpt-a', 'anthropic/claude-a', 'google/gemini-a'],
  );
  assert.deepEqual(catalog.models.map(model => model.priority), [0, 1, 2, 3]);
});

test('rejects an empty or protocol-mismatched catalog', () => {
  assert.throws(() => createCodexModelCatalog([]), /any Responses models/);
  assert.throws(
    () => createCodexModelCatalog([{ slug: 'chat-only', suitable_api: 'chat.completions' }]),
    /any Responses models/,
  );
});

test('rejects duplicate native aliases', () => {
  assert.throws(() => createCodexModelCatalog([
    { slug: 'openai/gpt-a', aliases: ['gpt-native'], suitable_api: 'responses' },
    { slug: 'openai/gpt-b', aliases: ['gpt-native'], suitable_api: 'responses' },
  ]), /duplicate slug: gpt-native/);
});
