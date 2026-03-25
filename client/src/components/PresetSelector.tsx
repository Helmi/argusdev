import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface CommandPreset {
    id: string;
    name: string;
    command: string;
    args?: string[];
    fallbackArgs?: string[];
    detectionStrategy?: string;
}

interface PresetSelectorProps {
    onSelect: (presetId: string) => void;
    onCancel: () => void;
    token?: string;
    selectedWorktreePath: string;
}

export const PresetSelector = ({ onSelect, onCancel, selectedWorktreePath }: PresetSelectorProps) => {
    const [presets, setPresets] = useState<CommandPreset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchPresets = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await apiFetch('/api/presets');
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                const data = await res.json();
                setPresets(data);
                if (data.length > 0) {
                    setSelectedPresetId(data[0].id); // Select first by default
                }
            } catch (e) {
                setError("Failed to load presets: " + (e as Error).message);
            } finally {
                setLoading(false);
            }
        };
        fetchPresets();
    }, []);

    const handleSelect = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedPresetId) {
            onSelect(selectedPresetId);
        }
    };

    if (loading) {
        return (
            <div className="p-8 text-center text-gray-400">
                Loading presets...
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-center text-red-400">
                Error: {error}
            </div>
        );
    }

    if (presets.length === 0) {
        return (
            <div className="p-8 text-center text-gray-400">
                No presets found. Please configure them in the CLI.
                <div className="mt-4">
                    <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white">
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8">
            <h2 className="text-xl font-bold mb-4 text-white">Select Preset for Session</h2>
            <p className="text-gray-400 mb-6 truncate max-w-lg">Worktree: {selectedWorktreePath}</p>
            
            <form onSubmit={handleSelect} className="flex flex-col gap-4">
                <select
                    value={selectedPresetId || ''}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-white focus:ring-blue-500 focus:border-blue-500"
                >
                    {presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                            {preset.name} ({preset.command} {preset.args?.join(' ')})
                        </option>
                    ))}
                </select>

                <div className="flex gap-4 mt-2">
                    <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold">
                        Start Session
                    </button>
                    <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white">
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};
