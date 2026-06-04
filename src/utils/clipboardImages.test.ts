import {describe, expect, it} from 'vitest';
import {
	inferClipboardImageMimeType,
	normalizeClipboardImageMimeType,
	parseClipboardImageDataUrl,
	resolveClipboardImageType,
} from './clipboardImages.js';

describe('clipboardImages', () => {
	it('normalizes browser clipboard MIME aliases', () => {
		expect(normalizeClipboardImageMimeType('image/png')).toBe('image/png');
		expect(
			normalizeClipboardImageMimeType(' image/x-png; charset=binary '),
		).toBe('image/png');
		expect(normalizeClipboardImageMimeType('image/jpg')).toBe('image/jpeg');
		expect(normalizeClipboardImageMimeType('image/tiff')).toBe(null);
	});

	it('parses base64 data URLs with MIME parameters', () => {
		expect(
			parseClipboardImageDataUrl('data:image/png;base64,aGVsbG8='),
		).toEqual({
			declaredMimeType: 'image/png',
			base64Data: 'aGVsbG8=',
		});
		expect(
			parseClipboardImageDataUrl(
				'data:image/png;charset=utf-8;base64,aGVsbG8=',
			),
		).toEqual({
			declaredMimeType: 'image/png',
			base64Data: 'aGVsbG8=',
		});
		expect(parseClipboardImageDataUrl('data:image/png,aGVsbG8=')).toBe(null);
	});

	it('infers PNG images from bytes when clipboard MIME is wrong', () => {
		const png = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
		]);

		expect(inferClipboardImageMimeType(png)).toBe('image/png');
		expect(resolveClipboardImageType('image/tiff', 'image/tiff', png)).toEqual({
			mimeType: 'image/png',
			extension: 'png',
		});
	});

	it('uses supported declared MIME when byte inference is unavailable', () => {
		expect(
			resolveClipboardImageType(
				'',
				'image/x-png',
				Buffer.from('not-enough-data'),
			),
		).toEqual({
			mimeType: 'image/png',
			extension: 'png',
		});
	});
});
