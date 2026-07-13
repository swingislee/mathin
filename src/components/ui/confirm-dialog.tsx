"use client";
import { Button } from "./button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "./dialog";

export function ConfirmDialog({open,onOpenChange,title,description,confirmLabel,cancelLabel,onConfirm,pending=false}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;confirmLabel:string;cancelLabel:string;onConfirm:()=>void;pending?:boolean}){
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={()=>onOpenChange(false)}>{cancelLabel}</Button><Button type="button" disabled={pending} onClick={onConfirm}>{confirmLabel}</Button></DialogFooter></DialogContent></Dialog>;
}
