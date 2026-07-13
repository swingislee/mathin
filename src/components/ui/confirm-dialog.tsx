"use client";
import { Button } from "./button";
import { AlertDialog,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from "./alert-dialog";

export function ConfirmDialog({open,onOpenChange,title,description,confirmLabel,cancelLabel,onConfirm,pending=false}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;confirmLabel:string;cancelLabel:string;onConfirm:()=>void;pending?:boolean}){
 return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={()=>onOpenChange(false)}>{cancelLabel}</Button><Button type="button" disabled={pending} onClick={onConfirm}>{confirmLabel}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
