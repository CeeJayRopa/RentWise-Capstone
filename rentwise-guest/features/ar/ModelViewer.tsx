import { useEffect, useRef, useState } from "react";
import { Platform, View, StyleSheet } from "react-native";

interface ModelViewerProps {
  src: string;
  poster?: string;
}

export default function ModelViewer({ src, poster }: ModelViewerProps) {
  const containerRef = useRef<View>(null);
  const elRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    let cancelled = false;

    import("@google/model-viewer").then(() => {
      if (cancelled) return;
      const container = containerRef.current as unknown as HTMLElement | null;
      if (!container) return;

      const el = document.createElement("model-viewer") as any;
      el.style.width = "100%";
      el.style.height = "100%";
      el.cameraControls = true;
      el.autoRotate = true;

      container.appendChild(el);
      elRef.current = el;
      setReady(true);
    });

    return () => {
      cancelled = true;
      if (elRef.current?.parentNode) {
        elRef.current.parentNode.removeChild(elRef.current);
      }
      elRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !elRef.current) return;
    elRef.current.src = src;
    elRef.current.poster = poster ?? "";
  }, [ready, src, poster]);

  return <View ref={containerRef} style={StyleSheet.absoluteFill} />;
}
