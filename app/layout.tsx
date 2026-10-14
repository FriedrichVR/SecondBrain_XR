import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Second Brain — WebXR JSON Visualizer',
  description: 'Upload JSON, inspect in 2D, explore as a 3D knowledge graph in Meta Quest 3 via WebXR.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-zinc-200 antialiased">{children}</body>
    </html>
  );
}
