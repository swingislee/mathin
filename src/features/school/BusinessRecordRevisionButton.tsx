'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { businessRevisionMessages, type BusinessRecordRevisionTarget } from './business-record-revision-contract';

const RevisionDialog = dynamic(() => import('./BusinessRecordRevisionDialog'));
export function BusinessRecordRevisionButton({kind,recordId,label,subject}:BusinessRecordRevisionTarget & {label?:string;subject?:string}) {
  const locale = useLocale(), [open,setOpen] = useState(false);
  return <>
    <Button type="button" size="sm" variant="ghost" data-business-revision={kind} onClick={event=>{event.stopPropagation();setOpen(true);}}>{label ?? businessRevisionMessages(locale).edit}</Button>
    {open && <RevisionDialog kind={kind} recordId={recordId} subject={subject} onClose={()=>setOpen(false)}/>}
  </>;
}
