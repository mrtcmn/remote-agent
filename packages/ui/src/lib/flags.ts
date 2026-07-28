// Feature flags. Compile-time constants — flip here, no env vars.
// ponytail: constants not env; add runtime config only if a flag must change without a rebuild.
export const FEATURE_SECTION_TASKS = false; // Tasks/Kanban sidebar tab + /kanban route
export const FEATURE_SESSION_SSH = false; // SSH sidebar section + /ssh sessions
