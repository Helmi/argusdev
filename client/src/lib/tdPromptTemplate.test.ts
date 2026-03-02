import {describe, expect, it} from 'vitest';
import {
	getPreferredPromptTemplateName,
	shouldAutoReplacePromptTemplate,
} from './tdPromptTemplate';

const templates = [
	{name: 'work-default', path: '/tmp/work.md'},
	{name: 'review-default', path: '/tmp/review.md'},
];

describe('tdPromptTemplate', () => {
	it('prefers configured template name when present', () => {
		expect(getPreferredPromptTemplateName(templates, 'review-default')).toBe(
			'review-default',
		);
	});

	it('matches configured template name case-insensitively', () => {
		expect(getPreferredPromptTemplateName(templates, 'Review-Default')).toBe(
			'review-default',
		);
	});

	it('falls back to first template when preferred is missing', () => {
		expect(getPreferredPromptTemplateName(templates, 'missing-template')).toBe(
			'work-default',
		);
	});

	it('falls back to first template when preferred is empty', () => {
		expect(getPreferredPromptTemplateName(templates, '')).toBe('work-default');
	});

	it('returns undefined when no templates exist', () => {
		expect(
			getPreferredPromptTemplateName([], 'review-default'),
		).toBeUndefined();
	});

	it('auto-replaces when current is empty', () => {
		expect(shouldAutoReplacePromptTemplate('', 'review-default')).toBe(true);
	});

	it('auto-replaces when current matches previous auto value', () => {
		expect(
			shouldAutoReplacePromptTemplate('review-default', 'review-default'),
		).toBe(true);
	});

	it('does not auto-replace user-selected template', () => {
		expect(
			shouldAutoReplacePromptTemplate('my-custom-template', 'review-default'),
		).toBe(false);
	});
});
