import type { ReactNode } from "react";

export type FeedbackTone = "error" | "notice" | "status";

const toneClassName: Record<FeedbackTone, string> = {
  error: "error-banner",
  notice: "notice",
  status: "status-banner",
};

const toneRole: Record<FeedbackTone, "alert" | "status"> = {
  error: "alert",
  notice: "status",
  status: "status",
};

export function FeedbackBanner({
  actions,
  children,
  className,
  tone,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone: FeedbackTone;
}) {
  const classes = [toneClassName[tone], actions ? "stack stack-sm" : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={toneRole[tone]} aria-live="polite">
      <div>{children}</div>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
