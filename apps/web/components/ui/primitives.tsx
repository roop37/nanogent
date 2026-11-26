"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { LoaderCircle, X } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-input px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
export function Separator() {
  return <hr className="border-t" />;
}
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={cn("spinner size-3.5", className)} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton h-4", className)} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 rounded border border-input bg-input-background px-3", className)}
      {...props}
    />
  );
}
export function Tooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            sideOffset={8}
            className="z-[70] rounded border border-input bg-background px-2 py-1 text-xs"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={cn("dialog-content", className)}>
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close
            aria-label="Close dialog"
            className="absolute right-3 top-3 rounded p-1 hover:bg-accent"
          >
            <X size={14} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content side="top" align="start" sideOffset={8} className="popover">
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;
export function TabsList(props: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className="flex gap-1 border-b" {...props} />;
}
export function TabsTrigger(props: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className="border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary data-[state=active]:bg-accent"
      {...props}
    />
  );
}
export function Toast({ message, dismiss }: { message: string; dismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(dismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, dismiss]);
  return message ? (
    <output className="fixed bottom-9 right-4 z-[80] flex max-w-[calc(100vw-32px)] items-center gap-5 rounded border border-input bg-background px-4 py-3">
      {message}
      <button type="button" onClick={dismiss} aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </output>
  ) : null;
}
