import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

function readSource(): string {
	return readFileSync(
		resolve(process.cwd(), 'client/src/components/IntegratePickerDialog.tsx'),
		'utf8',
	)
}

describe('IntegratePickerDialog regression (td-681e20)', () => {
	const source = readSource()

	it('tracks userEditedText state to prevent template overwrite', () => {
		expect(source).toContain('userEditedText')
		expect(source).toContain('setUserEditedText')
		// Textarea onChange must flip the flag
		expect(source).toMatch(/setUserEditedText\(true\)/)
		// Reset on worktree change
		expect(source).toMatch(/setUserEditedText\(false\)/)
		// Template effect must early-return when user has edited
		expect(source).toMatch(/if\s*\(userEditedText\)\s*return/)
	})

	it('reset and template effects depend on selectedWorktreePath, not the worktree object', () => {
		// CRITICAL: depending on `selectedWorktree` (object) re-fires the effect
		// on every poll/socket refresh because the parent recomputes the
		// worktrees array (new object identity even when the path is unchanged).
		// That would clobber userEditedText and wipe the user's text.
		// Both effects must depend on the stable string path.

		// Find the reset effect (the one that calls setParentBranch +
		// setUserEditedText(false)) and check its dep array.
		const resetEffectMatch = source.match(
			/setParentBranch\(parent\);\s*setUserEditedText\(false\);[\s\S]*?\},\s*\[([^\]]+)\]/,
		)
		expect(resetEffectMatch).not.toBeNull()
		const resetDeps = resetEffectMatch![1]
		expect(resetDeps).toContain('selectedWorktreePath')
		// Object identity dep would defeat the fix.
		expect(resetDeps).not.toMatch(/\bselectedWorktree\b(?!Path)/)

		// Find the template effect (the one calling setText with renderTemplate)
		// and check its dep array.
		const templateEffectMatch = source.match(
			/setText\(renderTemplate\(DEFAULT_TEMPLATE,\s*vars\)\);[\s\S]*?\},\s*\[([^\]]+)\]/,
		)
		expect(templateEffectMatch).not.toBeNull()
		const templateDeps = templateEffectMatch![1]
		expect(templateDeps).toContain('selectedWorktreePath')
		expect(templateDeps).not.toMatch(/\bselectedWorktree\b(?!Path)/)
	})
})
