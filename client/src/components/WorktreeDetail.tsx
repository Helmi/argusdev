import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { GitBranch, Play, Trash2, GitMerge, AlertTriangle, ArrowRight, Square, ExternalLink, Terminal } from 'lucide-react';
import { PresetSelector } from './PresetSelector';

interface Worktree {
    path: string;
    branch?: string;
    isMainWorktree: boolean;
    hasSession: boolean;
}

interface WorktreeDetailProps {
    worktree: Worktree;
    token: string;
    activeSessionId?: string;
    onStartSession: (path: string, presetId?: string) => Promise<void>;
    onResumeSession: (sessionId: string) => void;
    onStopSession: (sessionId: string) => Promise<void>;
    onDeleteSuccess: () => void;
}

export const WorktreeDetail = ({ 
    worktree, 
    token, 
    activeSessionId, 
    onStartSession, 
    onResumeSession,
    onStopSession,
    onDeleteSuccess 
}: WorktreeDetailProps) => {
    const [mode, setMode] = useState<'view' | 'merge' | 'delete'>('view');
    const [branches, setBranches] = useState<string[]>([]);
    const [targetBranch, setTargetBranch] = useState('main');
    const [useRebase, setUseRebase] = useState(false);
    const [deleteBranch, setDeleteBranch] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    useEffect(() => {
        if (mode === 'merge') {
            setLoading(true);
            apiFetch('/api/branches')
                .then(res => res.json())
                .then(data => {
                    setBranches(data);
                    if (data.includes('main')) setTargetBranch('main');
                    else if (data.includes('master')) setTargetBranch('master');
                })
                .catch(console.error)
                .finally(() => setLoading(false));
        }
        setError(null);
        setSuccessMsg(null);
    }, [mode]);

    const handleMerge = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch('/api/worktree/merge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourceBranch: worktree.branch,
                    targetBranch,
                    useRebase
                })
            });
            
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error);
            }
            
            setSuccessMsg(`Successfully merged ${worktree.branch} into ${targetBranch}`);
            setTimeout(() => setMode('view'), 2000);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        if (!activeSessionId) return;
        if (!confirm('Are you sure you want to stop the running session? This will kill the process.')) return;
        
        setLoading(true);
        try {
            await onStopSession(activeSessionId);
            setSuccessMsg('Session stopped successfully');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        setLoading(true);
        setError(null);
        try {
            if (activeSessionId) {
                await onStopSession(activeSessionId);
            }

            const res = await apiFetch('/api/worktree/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    path: worktree.path,
                    deleteBranch
                })
            });
            
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error);
            }
            
            onDeleteSuccess();
        } catch (e) {
            setError((e as Error).message);
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-900 h-full overflow-y-auto">
            <div className="w-full max-w-2xl bg-gray-800/50 border border-gray-700 rounded-xl p-8 shadow-xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-900/30 mb-4 relative">
                        <GitBranch className="w-8 h-8 text-blue-400" />
                        {activeSessionId && (
                            <div className="absolute top-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-900 animate-pulse" title="Active Session" />
                        )}
                    </div>
                    <h2 className="text-2xl font-bold text-white mb-2">
                        {worktree.branch || 'Main Worktree'}
                    </h2>
                    <p className="text-gray-500 font-mono text-sm break-all">
                        {worktree.path}
                    </p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-800 text-red-400 rounded-lg text-sm text-center">
                        {error}
                    </div>
                )}
                
                {successMsg && (
                    <div className="mb-6 p-4 bg-green-900/20 border border-green-800 text-green-400 rounded-lg text-sm text-center">
                        {successMsg}
                    </div>
                )}

                {/* VIEW MODE: Actions */}
                {mode === 'view' && (
                    <div className="space-y-8">
                        {activeSessionId ? (
                            // Active Session Actions
                            <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-700">
                                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                                    <Terminal className="w-5 h-5 text-green-400" /> Active Session Running
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => onResumeSession(activeSessionId)}
                                        className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-bold"
                                    >
                                        <ExternalLink className="w-5 h-5" /> Resume Session
                                    </button>
                                    <button
                                        onClick={handleStop}
                                        disabled={loading}
                                        className="flex items-center justify-center gap-2 px-4 py-3 bg-red-900/30 hover:bg-red-900/50 border border-red-800 rounded-lg text-red-400 hover:text-red-300"
                                    >
                                        <Square className="w-5 h-5 fill-current" /> Stop Session
                                    </button>
                                </div>
                            </div>
                        ) : (
                            // Start Session
                            <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-700">
                                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                                    <Play className="w-5 h-5 text-green-400" /> Start Session
                                </h3>
                                <PresetSelector 
                                    onSelect={(presetId) => onStartSession(worktree.path, presetId)}
                                    onCancel={() => {}} 
                                    token={token}
                                    selectedWorktreePath={worktree.path}
                                />
                            </div>
                        )}

                        {/* Secondary Actions */}
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setMode('merge')}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-lg text-gray-300 hover:text-white transition-all"
                            >
                                <GitMerge className="w-5 h-5" /> Merge Worktree
                            </button>
                            
                            {!worktree.isMainWorktree && (
                                <button
                                    onClick={() => setMode('delete')}
                                    className="flex items-center justify-center gap-2 px-4 py-3 bg-red-900/10 hover:bg-red-900/30 border border-red-900/30 hover:border-red-800 rounded-lg text-red-400 hover:text-red-300 transition-all"
                                >
                                    <Trash2 className="w-5 h-5" /> Delete Worktree
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* MERGE MODE */}
                {mode === 'merge' && (
                    <div className="bg-gray-900/50 rounded-lg p-6 border border-gray-700">
                        <h3 className="text-lg font-medium text-white mb-6 flex items-center gap-2">
                            <GitMerge className="w-5 h-5 text-purple-400" /> Merge Branch
                        </h3>
                        
                        <div className="flex items-center justify-center gap-4 mb-8 text-sm">
                            <div className="bg-gray-800 px-3 py-1 rounded text-blue-400 font-mono">{worktree.branch}</div>
                            <ArrowRight className="w-4 h-4 text-gray-600" />
                            <div className="bg-gray-800 px-3 py-1 rounded text-purple-400 font-mono">{targetBranch}</div>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">Target Branch</label>
                                <select 
                                    value={targetBranch}
                                    onChange={(e) => setTargetBranch(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
                                    disabled={loading}
                                >
                                    {branches.map(b => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-3 bg-gray-800 p-3 rounded">
                                <input
                                    type="checkbox"
                                    id="rebase"
                                    checked={useRebase}
                                    onChange={(e) => setUseRebase(e.target.checked)}
                                    className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600"
                                />
                                <div>
                                    <label htmlFor="rebase" className="text-gray-300 block">Use Rebase</label>
                                    <p className="text-xs text-gray-500">Rebase source branch onto target before merging (cleaner history).</p>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleMerge}
                                    disabled={loading}
                                    className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold disabled:opacity-50"
                                >
                                    {loading ? 'Merging...' : 'Merge'}
                                </button>
                                <button
                                    onClick={() => setMode('view')}
                                    disabled={loading}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* DELETE MODE */}
                {mode === 'delete' && (
                    <div className="bg-red-900/10 rounded-lg p-6 border border-red-900/30">
                        <h3 className="text-lg font-medium text-red-400 mb-6 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5" /> Delete Worktree?
                        </h3>
                        
                        <p className="text-gray-300 mb-6">
                            Are you sure you want to delete <span className="font-mono text-white">{worktree.path}</span>?
                            {activeSessionId && (
                                <span className="block mt-2 text-red-400 font-bold">Warning: An active session is running in this worktree. It will be stopped.</span>
                            )}
                            <br />This action cannot be undone.
                        </p>

                        <div className="flex items-center gap-3 bg-gray-900/50 p-3 rounded mb-6 border border-red-900/20">
                            <input
                                type="checkbox"
                                id="deleteBranch"
                                checked={deleteBranch}
                                onChange={(e) => setDeleteBranch(e.target.checked)}
                                className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-red-500 focus:ring-red-900"
                            />
                            <div>
                                <label htmlFor="deleteBranch" className="text-gray-300 block">Delete Branch <span className="font-mono text-red-400">{worktree.branch}</span></label>
                                <p className="text-xs text-gray-500">Also delete the git branch associated with this worktree.</p>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleDelete}
                                disabled={loading}
                                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-bold disabled:opacity-50"
                            >
                                {loading ? 'Deleting...' : 'Delete Permanently'}
                            </button>
                            <button
                                onClick={() => setMode('view')}
                                disabled={loading}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};