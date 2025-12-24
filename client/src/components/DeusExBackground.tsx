import { motion } from "framer-motion";
import { useMemo } from "react";

interface GeometricShape {
  id: number;
  type: "triangle" | "diamond" | "hexagon" | "fragment";
  x: number;
  y: number;
  size: number;
  rotation: number;
  delay: number;
  duration: number;
  opacity: number;
  filled: boolean;
}

export function DeusExBackground() {
  const shapes = useMemo(() => {
    const generated: GeometricShape[] = [];
    const shapeTypes: GeometricShape["type"][] = ["triangle", "diamond", "hexagon", "fragment"];
    
    for (let i = 0; i < 12; i++) {
      generated.push({
        id: i,
        type: shapeTypes[Math.floor(Math.random() * shapeTypes.length)],
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 30 + Math.random() * 60,
        rotation: Math.random() * 360,
        delay: Math.random() * 2,
        duration: 20 + Math.random() * 15,
        opacity: 0.12 + Math.random() * 0.12,
        filled: Math.random() > 0.5,
      });
    }
    return generated;
  }, []);

  const renderShape = (shape: GeometricShape) => {
    const strokeColor = "rgba(220, 180, 100, 0.5)";
    const fillColor = shape.filled ? "rgba(180, 140, 60, 0.08)" : "none";
    
    switch (shape.type) {
      case "triangle":
        return (
          <polygon 
            points="50,5 95,95 5,95" 
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth="1.5"
          />
        );
      case "diamond":
        return (
          <polygon 
            points="50,5 95,50 50,95 5,50" 
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth="1.5"
          />
        );
      case "hexagon":
        return (
          <polygon 
            points="50,5 93,27 93,73 50,95 7,73 7,27" 
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth="1.5"
          />
        );
      case "fragment":
        return (
          <polygon 
            points="20,10 80,5 95,40 70,90 30,85 5,50" 
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth="1"
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Subtle atmospheric gradient base */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 10% 90%, rgba(180, 140, 60, 0.1) 0%, transparent 50%),
            radial-gradient(ellipse at 90% 10%, rgba(160, 120, 50, 0.06) 0%, transparent 45%),
            linear-gradient(180deg, rgba(5, 5, 3, 0.3) 0%, rgba(15, 12, 8, 0.4) 50%, rgba(5, 5, 3, 0.3) 100%)
          `
        }}
      />
      
      {/* Subtle diagonal light from bottom-left corner - static */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(135deg, rgba(200, 160, 80, 0.06) 0%, transparent 50%)
          `
        }}
      />

      {/* Floating geometric shapes - simplified animations */}
      {shapes.map((shape) => (
        <motion.div
          key={shape.id}
          className="absolute will-change-transform"
          style={{
            left: `${shape.x}%`,
            top: `${shape.y}%`,
            width: shape.size,
            height: shape.size,
          }}
          initial={{ 
            opacity: 0, 
            rotate: shape.rotation,
          }}
          animate={{ 
            opacity: [0, shape.opacity, shape.opacity, 0],
            rotate: shape.rotation + 180,
          }}
          transition={{
            duration: shape.duration,
            delay: shape.delay,
            repeat: Infinity,
            ease: "linear"
          }}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {renderShape(shape)}
          </svg>
        </motion.div>
      ))}

      {/* Vignette overlay */}
      <div 
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(0, 0, 0, 0.4) 100%)"
        }}
      />
    </div>
  );
}

export function DeusExGlow() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Bottom left - main warm glow - no blur filter, just gradient */}
      <div 
        className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full opacity-60"
        style={{
          background: "radial-gradient(circle, rgba(180, 140, 60, 0.15) 0%, transparent 70%)",
        }}
      />
      
      {/* Top right corner */}
      <div 
        className="absolute -top-24 -right-24 w-[280px] h-[280px] rounded-full opacity-50"
        style={{
          background: "radial-gradient(circle, rgba(160, 120, 50, 0.12) 0%, transparent 70%)",
        }}
      />

      {/* Bottom right */}
      <div 
        className="absolute -bottom-24 -right-24 w-[300px] h-[300px] rounded-full opacity-50"
        style={{
          background: "radial-gradient(circle, rgba(200, 160, 80, 0.1) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
