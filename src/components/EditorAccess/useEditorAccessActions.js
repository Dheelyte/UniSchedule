'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useConfirm } from '@/components/ConfirmModal/ConfirmContext';
import { useToast } from '@/components/Toast/Toast';
import { grantConfirmation, retractConfirmation, reverseConfirmation } from '@/lib/editorAccess';

// Grant, retract and reverse editor access, each behind its confirmation
// dialog. Afterwards the signed-in user is re-read, so a role that just
// changed shows everywhere without signing out.
export function useEditorAccessActions() {
    const { refreshUser } = useAuth();
    const confirm = useConfirm();
    const { addToast } = useToast();
    const [busy, setBusy] = useState(false);

    const run = async (dialog, request, success) => {
        if (busy || !await confirm(dialog)) return false;
        setBusy(true);
        try {
            await request();
        } catch (e) {
            addToast({ type: 'error', title: 'Editor access unchanged', message: e.message || 'Could not change editor access.' });
            setBusy(false);
            return false;
        }
        try {
            await refreshUser();
        } catch {
            // The change went through; the next page load shows it.
        }
        addToast({ type: 'success', ...success });
        setBusy(false);
        return true;
    };

    const grant = (person, facultyName) => run(
        grantConfirmation(person.email, facultyName),
        () => apiClient.post('/editor-access/grant', { user_id: person.id }),
        { title: 'Editor access granted', message: `${person.email} is now a Faculty Editor. You are a Faculty Viewer until you retract it.` },
    );

    // `to` is another Faculty Viewer, or null to take the access back.
    const retract = (handover, to = null) => run(
        retractConfirmation(handover.holder.email, to?.email || null),
        () => apiClient.post('/editor-access/retract', { to_user_id: to ? to.id : null }),
        to
            ? { title: 'Editor access moved', message: `${to.email} is now the Faculty Editor; ${handover.holder.email} is back to Faculty Viewer.` }
            : { title: 'Editor access retracted', message: `You are a Faculty Editor again; ${handover.holder.email} is back to Faculty Viewer.` },
    );

    const reverse = (handover) => run(
        reverseConfirmation(handover),
        () => apiClient.post(`/editor-access/handovers/${handover.id}/reverse`, {}),
        { title: 'Handover reversed', message: `${handover.granted_by.email} is Faculty Editor of ${handover.faculty_name} again.` },
    );

    return { grant, retract, reverse, busy };
}
