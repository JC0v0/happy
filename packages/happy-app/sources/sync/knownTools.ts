/**
 * Tool mutability registry used by sync/storage to flag file-modifying tool
 * calls. Extracted from the old components/tools/knownTools.tsx UI registry
 * when the agent chat UI was removed; only the mutability information is
 * still needed by sync internals.
 */

const MUTABLE_TOOLS: ReadonlySet<string> = new Set([
    'Task',
    'Agent',
    'Bash',
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
    'CodexBash',
    'edit',
    'shell',
    'execute',
    'GeminiBash',
    'GeminiPatch',
]);

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
    'Glob',
    'Grep',
    'LS',
    'ExitPlanMode',
    'exit_plan_mode',
    'Read',
    'read',
    'WebFetch',
    'NotebookRead',
    'TodoWrite',
    'WebSearch',
    'CodexReasoning',
    'GeminiReasoning',
    'think',
    'change_title',
    'search',
    'CodexPatch',
    'CodexDiff',
    'GeminiDiff',
    'AskUserQuestion',
    'Skill',
    'ToolSearch',
]);

/**
 * Check if a tool is mutable (can potentially modify files)
 * @param toolName The name of the tool to check
 * @returns true if the tool is mutable or unknown, false if it's read-only
 */
export function isMutableTool(toolName: string): boolean {
    if (MUTABLE_TOOLS.has(toolName)) {
        return true;
    }
    if (READ_ONLY_TOOLS.has(toolName)) {
        return false;
    }
    // If tool is unknown, assume it's mutable to be safe
    return true;
}
