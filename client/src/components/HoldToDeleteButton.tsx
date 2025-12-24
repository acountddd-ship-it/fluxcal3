import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HoldToDeleteButtonProps {
  onDelete: () => void;
  className?: string;
  testId?: string;
}

export function HoldToDeleteButton({ 
  onDelete, 
  className = "",
  testId 
}: HoldToDeleteButtonProps) {
  const [isPressed, setIsPressed] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon"
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => {
        if (isPressed) {
          onDelete();
        }
        setIsPressed(false);
      }}
      onMouseLeave={() => setIsPressed(false)}
      onTouchStart={() => setIsPressed(true)}
      onTouchEnd={() => {
        if (isPressed) {
          onDelete();
        }
        setIsPressed(false);
      }}
      onTouchCancel={() => setIsPressed(false)}
      className={`h-6 w-6 select-none touch-manipulation ${isPressed ? 'text-destructive' : 'text-muted-foreground/60'} ${className}`}
      style={{ 
        WebkitTapHighlightColor: 'transparent',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none'
      }}
      data-testid={testId}
    >
      <Trash2 className="w-3 h-3" />
    </Button>
  );
}
