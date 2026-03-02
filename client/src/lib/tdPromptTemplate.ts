import type {TdPromptTemplate} from './types';

export function getPreferredPromptTemplateName(
	templates: TdPromptTemplate[],
	preferredName?: string,
): string | undefined {
	if (templates.length === 0) return undefined;
	if (!preferredName) return templates[0]?.name;

	const normalized = preferredName.trim().toLowerCase();
	if (!normalized) return templates[0]?.name;

	const match = templates.find(
		template => template.name.trim().toLowerCase() === normalized,
	);
	return match?.name || templates[0]?.name;
}

export function shouldAutoReplacePromptTemplate(
	currentTemplate: string,
	lastAutoTemplate: string,
): boolean {
	return !currentTemplate || currentTemplate === lastAutoTemplate;
}
