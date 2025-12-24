import { motion } from "framer-motion";

interface AMPMToggleProps {
  value: "AM" | "PM";
  onChange: (value: "AM" | "PM") => void;
  className?: string;
}

export function AMPMToggle({ value, onChange, className = "" }: AMPMToggleProps) {
  const toggle = () => {
    onChange(value === "AM" ? "PM" : "AM");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`relative h-8 w-14 rounded-md bg-secondary/40 border border-border/30 overflow-hidden ${className}`}
    >
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        key={value}
        initial={{ y: value === "AM" ? 20 : -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: value === "AM" ? -20 : 20, opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        <span className="text-xs font-medium text-primary/80">{value}</span>
      </motion.div>
    </button>
  );
}
