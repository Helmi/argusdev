import {useState} from 'react';
import {ChevronRight, ChevronDown} from 'lucide-react';

interface SdkThinkingBlockProps {
	text: string;
	defaultExpanded?: boolean;
}

export function SdkThinkingBlock({
	text,
	defaultExpanded = false,
}: SdkThinkingBlockProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	return (
		<div className="my-1">
			<button
				type="button"
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? (
					<ChevronDown className="h-3 w-3" />
				) : (
					<ChevronRight className="h-3 w-3" />
				)}
				<span className="italic">Thinking...</span>
			</button>
			{expanded && (
				<div className="mt-1 pl-4 text-xs text-muted-foreground italic font-mono whitespace-pre-wrap leading-relaxed">
					{text}
				</div>
			)}
		</div>
	);
}
