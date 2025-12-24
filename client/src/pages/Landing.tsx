import { Button } from "@/components/ui/button";
import { Flame } from "lucide-react";
import { motion } from "framer-motion";
import { DeusExBackground, DeusExGlow } from "@/components/DeusExBackground";

export default function Landing() {
  const fluxLetters = "FLUX".split("");
  
  // Generate random pulsing rates for each letter for sparkling effect
  const randomDurations = fluxLetters.map(() => 0.75 + Math.random() * 0.75);
  
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative">
      <DeusExBackground />
      <DeusExGlow />
      <div className="max-w-sm w-full space-y-12 relative z-10">
        {/* Logo and title */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <Flame className="h-8 w-8 text-primary/80" />
          </div>
          <h1 className="text-2xl font-extralight tracking-[0.2em] text-foreground/90 flex items-center justify-center">
            {fluxLetters.map((letter, index) => (
              <motion.span
                key={index}
                className="inline-block"
                style={{
                  textShadow: "0 0 8px rgba(242, 162, 60, 0.7), 0 0 16px rgba(242, 162, 60, 0.5), 0 0 24px rgba(242, 162, 60, 0.3)"
                }}
                animate={{
                  textShadow: [
                    "0 0 6px rgba(242, 162, 60, 0.5), 0 0 12px rgba(242, 162, 60, 0.3)",
                    "0 0 16px rgba(242, 162, 60, 1), 0 0 32px rgba(242, 162, 60, 1), 0 0 48px rgba(242, 162, 60, 0.72)",
                    "0 0 6px rgba(242, 162, 60, 0.5), 0 0 12px rgba(242, 162, 60, 0.3)"
                  ]
                }}
                transition={{
                  duration: randomDurations[index],
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                {letter}
              </motion.span>
            ))}
            <span className="text-foreground/40">CAL</span>
          </h1>
          <p className="text-[11px] tracking-[0.15em] text-muted-foreground/50 uppercase">
            Know your burn
          </p>
        </div>

        {/* Features - minimal list */}
        <div className="space-y-4 py-4 border-y border-border/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] tracking-wider text-muted-foreground/70 uppercase">Live burn</span>
            <span className="text-[10px] bg-gradient-to-r from-primary/80 to-accent/80 bg-clip-text text-transparent">second by second</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] tracking-wider text-muted-foreground/70 uppercase">Fasting states</span>
            <span className="text-[10px] bg-gradient-to-r from-primary/80 to-accent/80 bg-clip-text text-transparent">fed to autophagy</span>
          </div>
          <div className="flex items-center justify-center pt-2">
            <span className="text-[10px] tracking-wider text-muted-foreground/40 uppercase">and more</span>
          </div>
        </div>

        {/* Sign in */}
        <div className="space-y-4">
          <Button 
            onClick={() => window.location.href = "/api/login"}
            className="w-full h-12 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-light tracking-widest text-xs"
            data-testid="button-login"
          >
            SIGN IN
          </Button>
          <p className="text-[10px] text-center text-muted-foreground/40 tracking-wide">
            Google / GitHub / Apple / Email
          </p>
          
          {/* Test User Login */}
          <div className="pt-4 border-t border-dashed border-muted-foreground/20">
            <Button 
              onClick={async () => {
                try {
                  const res = await fetch("/api/dev/test-login", { 
                    method: "POST",
                    credentials: "include"
                  });
                  if (res.ok) {
                    window.location.href = "/";
                  } else {
                    console.error("Test login failed");
                  }
                } catch (error) {
                  console.error("Test login error:", error);
                }
              }}
              variant="outline"
              className="w-full h-10 border-dashed border-muted-foreground/30 text-muted-foreground/60 font-mono text-[10px] tracking-wider"
              data-testid="button-test-user"
            >
              TEST LOGIN
            </Button>
            <p className="text-[9px] text-center text-muted-foreground/30 mt-2 font-mono">
              Quick access for testing
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
