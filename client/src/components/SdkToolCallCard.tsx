import {useState} from 'react';
import {
	Terminal,
	FileEdit,
	Search,
	Eye,
	ChevronDown,
	ChevronRight,
	Check,
	XIcon,
	Wrench,
	FolderSearch,
	FileText,
	Pen,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

interface SdkToolCallCardProps {
	toolName: string;
	input: Record<string, unknown>;
	output?: string;
	isError?: boolean;
	isPending?: boolean;
	onApprove?: () => void;
	onReject?: () => void;
}

const TOOL_ICON_MAP: Record<string, typeof Terminal> = {
	Bash: Terminal,
	bash: Terminal,
	Edit: FileEdit,
	edit: FileEdit,
	Write: Pen,
	write: Pen,
	Read: Eye,
	read: Eye,
	Grep: Search,
	grep: Search,
	Glob: FolderSearch,
	glob: FolderSearch,
	FileSearch: FolderSearch,
	NotebookEdit: FileText,
};

const INPUT_COLLAPSE_THRESHOLD = 200;

function getToolIcon(name: string) {
	return TOOL_ICON_MAP[name] || Wrench;
}

function formatJson(obj: Record<string, unknown>): string {
	return JSON.stringify(obj, null, 2);
}

export function SdkToolCallCard({
	toolName,
	input,
	output,
	isError = false,
	isPending = false,
	onApprove,
	onReject,
}: SdkToolCallCardProps) {
	const inputStr = formatJson(input);
	const isLongInput = inputStr.length > INPUT_COLLAPSE_THRESHOLD;
	const [inputExpanded, setInputExpanded] = useState(!isLongInput);

	const Icon = getToolIcon(toolName);

	return (
		<div
			className={cn(
				'my-1 rounded-md border bg-card text-sm',
				isError ? 'border-red-500/50' : 'border-border',
			)}
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
				<Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
				<span className="font-medium text-xs text-foreground">{toolName}</span>
			</div>

			{/* Input */}
			<div className="px-3 py-2">
				{isLongInput && (
					<button
						type="button"
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
						onClick={() => setInputExpanded(!inputExpanded)}
					>
						{inputExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)}
						Input
					</button>
				)}
				{inputExpanded && (
					<pre className="text-xs font-mono bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
						{inputStr}
					</pre>
				)}
			</div>

			{/* Output */}
			{output !== undefined && (
				<div className="border-t border-border px-3 py-2">
					<span className="text-xs text-muted-foreground block mb-1">
						{isError ? 'Error' : 'Output'}
					</span>
					<pre
						className={cn(
							'text-xs font-mono rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all',
							isError ? 'bg-red-500/10 text-red-400' : 'bg-muted',
						)}
					>
						{output}
					</pre>
				</div>
			)}

			{/* Pending approval buttons */}
			{isPending && (
				<div className="flex items-center gap-2 border-t border-border px-3 py-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs text-green-500 border-green-500/50 hover:bg-green-500/10"
						onClick={onApprove}
					>
						<Check className="h-3 w-3 mr-1" />
						Approve
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs text-red-500 border-red-500/50 hover:bg-red-500/10"
						onClick={onReject}
					>
						<XIcon className="h-3 w-3 mr-1" />
						Reject
					</Button>
				</div>
			)}
		</div>
	);
}
