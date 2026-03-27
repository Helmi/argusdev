// Error messages for multi-project mode
export const MULTI_PROJECT_ERRORS = {
	NO_PROJECTS_DIR:
		'ARGUSDEV_PROJECTS_DIR environment variable is required in multi-project mode',
	INVALID_PROJECTS_DIR: 'ARGUSDEV_PROJECTS_DIR points to a non-existent directory',
	NO_PROJECTS_FOUND: 'No git repositories found in the projects directory',
	CORRUPTED_REPO: 'Git repository is corrupted or inaccessible',
} as const;
