const CLIPBOARD_IMAGE_EXTENSIONS = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
} as const;

type ClipboardImageMimeType = keyof typeof CLIPBOARD_IMAGE_EXTENSIONS;

const MIME_ALIASES: Record<string, ClipboardImageMimeType> = {
	'image/png': 'image/png',
	'image/x-png': 'image/png',
	'image/jpeg': 'image/jpeg',
	'image/jpg': 'image/jpeg',
	'image/pjpeg': 'image/jpeg',
	'image/webp': 'image/webp',
	'image/gif': 'image/gif',
};

export interface ClipboardImageDataUrl {
	declaredMimeType: string | null;
	base64Data: string;
}

export interface ClipboardImageType {
	mimeType: ClipboardImageMimeType;
	extension: string;
}

export function normalizeClipboardImageMimeType(
	mimeType: string | null | undefined,
): ClipboardImageMimeType | null {
	if (!mimeType) return null;

	const normalized = mimeType.split(';')[0]?.trim().toLowerCase();
	if (!normalized) return null;

	return MIME_ALIASES[normalized] ?? null;
}

export function parseClipboardImageDataUrl(
	imageData: string,
): ClipboardImageDataUrl | null {
	if (!imageData.startsWith('data:')) return null;

	const commaIndex = imageData.indexOf(',');
	if (commaIndex === -1) return null;

	const metadata = imageData.slice(5, commaIndex);
	const parts = metadata.split(';').map(part => part.trim().toLowerCase());
	if (!parts.includes('base64')) return null;

	const base64Data = imageData.slice(commaIndex + 1);
	if (!base64Data) return null;

	return {
		declaredMimeType: parts[0] || null,
		base64Data,
	};
}

export function inferClipboardImageMimeType(
	buffer: Buffer,
): ClipboardImageMimeType | null {
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return 'image/png';
	}

	if (
		buffer.length >= 3 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xd8 &&
		buffer[2] === 0xff
	) {
		return 'image/jpeg';
	}

	if (buffer.length >= 6) {
		const header = buffer.toString('ascii', 0, 6);
		if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
	}

	if (
		buffer.length >= 12 &&
		buffer.toString('ascii', 0, 4) === 'RIFF' &&
		buffer.toString('ascii', 8, 12) === 'WEBP'
	) {
		return 'image/webp';
	}

	return null;
}

export function resolveClipboardImageType(
	providedMimeType: string | null | undefined,
	declaredMimeType: string | null | undefined,
	buffer: Buffer,
): ClipboardImageType | null {
	const mimeType =
		inferClipboardImageMimeType(buffer) ??
		normalizeClipboardImageMimeType(declaredMimeType) ??
		normalizeClipboardImageMimeType(providedMimeType);
	if (!mimeType) return null;

	return {
		mimeType,
		extension: CLIPBOARD_IMAGE_EXTENSIONS[mimeType],
	};
}
