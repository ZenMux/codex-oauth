import { modelsCatalogUrl } from './constants.mjs';
import { requestJson } from './oauth.mjs';

const reasoningLevels = [
  ['low', 'Fast responses with lighter reasoning'],
  ['medium', 'Balances speed and reasoning depth for everyday tasks'],
  ['high', 'Greater reasoning depth for complex problems'],
  ['xhigh', 'Extra high reasoning depth for complex problems'],
].map(([effort, description]) => ({ effort, description }));

const defaultModelMessages = {
  instructions_template: 'You are Codex, a coding agent. Work with the user in the current workspace to complete software engineering tasks safely and accurately.',
  instructions_variables: null,
  approvals: null,
  auto_review: null,
  permissions: null,
};

function splitList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function catalogSlug(model) {
  if (!String(model.slug || '').startsWith('openai/gpt-')) return model.slug;
  const aliases = splitList(model.aliases);
  return aliases.find(alias => alias.startsWith('gpt-')) || model.slug.replace(/^openai\//, '');
}

export function createCodexModelCatalog(models) {
  if (!Array.isArray(models)) throw new Error('ZenMux model catalog did not return a model list');
  const responseModels = models.filter(model => splitList(model.suitable_api).includes('responses'));
  if (!responseModels.length) throw new Error('ZenMux model catalog did not return any Responses models');

  const catalogModels = responseModels.map((model, index) => {
    const supportsReasoning = Number(model.supports_reasoning) > 0;
    const usesNativeGptAlias = String(model.slug || '').startsWith('openai/gpt-');
    const inputModalities = splitList(model.input_modalities)
      .filter(modality => modality === 'text' || modality === 'image');
    const contextWindow = Number(model.context_length) || 128_000;
    return {
        slug: catalogSlug(model),
        display_name: `ZenMux · ${model.name || model.slug}`,
        description: model.description || `Use ${model.slug} through ZenMux.`,
        default_reasoning_level: supportsReasoning ? 'medium' : null,
        supported_reasoning_levels: supportsReasoning ? reasoningLevels : [],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: index,
        availability_nux: null,
        upgrade: null,
        model_messages: defaultModelMessages,
        truncation_policy: {
          mode: 'tokens',
          limit: 10_000,
        },
        default_reasoning_summary: 'none',
        default_verbosity: 'low',
        support_verbosity: true,
        apply_patch_tool_type: usesNativeGptAlias ? 'freeform' : null,
        ...(usesNativeGptAlias ? { web_search_tool_type: 'text_and_image' } : {}),
        include_plugin_usage_instructions: false,
        include_skills_usage_instructions: false,
        service_tiers: [],
        additional_speed_tiers: [],
        comp_hash: 'zenmux-0.2.0',
        supports_parallel_tool_calls: true,
        context_window: contextWindow,
        max_context_window: contextWindow,
        effective_context_window_percent: 95,
        experimental_supported_tools: [],
        input_modalities: inputModalities.length ? inputModalities : ['text'],
        supports_image_detail_original: inputModalities.includes('image'),
        supports_search_tool: usesNativeGptAlias,
        use_responses_lite: false,
        tool_mode: null,
        multi_agent_version: usesNativeGptAlias ? 'v2' : null,
    };
  });
  const slugs = new Set();
  for (const model of catalogModels) {
    if (!model.slug) throw new Error('ZenMux model catalog returned a model without a slug');
    if (slugs.has(model.slug)) throw new Error(`ZenMux model catalog returned duplicate slug: ${model.slug}`);
    slugs.add(model.slug);
  }
  return { models: catalogModels };
}

export async function fetchProductionModelCatalog(fetchImpl = fetch) {
  const payload = await requestJson(modelsCatalogUrl, {}, fetchImpl);
  return createCodexModelCatalog(payload.data);
}
