'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * น้องมีนา — menaIT V.2 mascot.
 * Blinking eyes, glowing antenna and a waving arm are built into the SVG;
 * pick an outer motion with `motion` (bob for idle, hop for loading).
 */
interface MascotProps {
    size?: number;
    motion?: 'bob' | 'hop' | 'none';
    bubble?: React.ReactNode;
    bubbleSide?: 'left' | 'right';
    className?: string;
}

export function Mascot({ size = 104, motion = 'bob', bubble, bubbleSide = 'left', className }: MascotProps) {
    const uid = useId().replace(/:/g, '');
    const body = `mBody-${uid}`;
    const arm = `mArm-${uid}`;
    const glow = `mGlow-${uid}`;

    return (
        <div className={cn('relative inline-flex shrink-0', className)}>
            {bubble && (
                <div
                    className={cn(
                        'v2-bubble absolute -top-2 w-max max-w-44 z-10',
                        bubbleSide === 'left' ? 'right-[85%]' : 'left-[85%]'
                    )}
                    style={bubbleSide === 'right' ? { borderRadius: '16px 16px 16px 4px' } : undefined}
                >
                    {bubble}
                </div>
            )}
            <svg
                width={size}
                height={size}
                viewBox="0 0 120 120"
                role="img"
                aria-label="น้องมีนา"
                className={cn(
                    'drop-shadow-[0_12px_14px_rgba(0,0,0,0.2)] v2-mascot-wiggle',
                    motion === 'bob' && 'v2-mascot-bob',
                    motion === 'hop' && 'v2-mascot-hop'
                )}
            >
                <defs>
                    <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#6fd0ff" />
                        <stop offset="1" stopColor="#1c6ef2" />
                    </linearGradient>
                    <linearGradient id={arm} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#3da5ff" />
                        <stop offset="1" stopColor="#1556c9" />
                    </linearGradient>
                    <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
                        <stop offset="0" stopColor="#b8ffe0" />
                        <stop offset="1" stopColor="#34d399" />
                    </radialGradient>
                </defs>

                <ellipse cx="60" cy="112" rx="30" ry="4" fill="#0b2a5b" opacity=".15" />
                <line x1="60" y1="24" x2="60" y2="11" stroke="#1556c9" strokeWidth="3.5" strokeLinecap="round" />
                <circle cx="60" cy="9" r="6" fill={`url(#${glow})`}>
                    <animate attributeName="r" values="5.5;7;5.5" dur="1.6s" repeatCount="indefinite" />
                </circle>
                <rect x="9" y="58" width="14" height="26" rx="7" fill={`url(#${arm})`} />
                <g>
                    <animateTransform
                        attributeName="transform"
                        type="rotate"
                        values="0 104 66;-28 104 66;0 104 66;-28 104 66;0 104 66;0 104 66"
                        keyTimes="0;.12;.24;.36;.48;1"
                        dur="3.4s"
                        repeatCount="indefinite"
                    />
                    <rect x="98" y="40" width="13" height="28" rx="6.5" fill={`url(#${arm})`} />
                </g>
                <rect x="18" y="22" width="84" height="80" rx="36" fill={`url(#${body})`} />
                <path d="M30 40 Q40 27 58 27" stroke="#fff" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".45" />
                <rect x="28" y="38" width="64" height="42" rx="21" fill="#fff" />
                <ellipse cx="47" cy="57" rx="6" ry="7" fill="#0f2748">
                    <animate attributeName="ry" values="7;7;0.8;7;7" keyTimes="0;.9;.94;.97;1" dur="4s" repeatCount="indefinite" />
                </ellipse>
                <ellipse cx="73" cy="57" rx="6" ry="7" fill="#0f2748">
                    <animate attributeName="ry" values="7;7;0.8;7;7" keyTimes="0;.9;.94;.97;1" dur="4s" repeatCount="indefinite" />
                </ellipse>
                <circle cx="49" cy="54" r="2" fill="#fff" />
                <circle cx="75" cy="54" r="2" fill="#fff" />
                <ellipse cx="37" cy="68" rx="5" ry="3" fill="#ff9fb8" opacity=".8" />
                <ellipse cx="83" cy="68" rx="5" ry="3" fill="#ff9fb8" opacity=".8" />
                <path d="M53 67 Q60 74 67 67" stroke="#0f2748" strokeWidth="3" strokeLinecap="round" fill="none" />
                <circle cx="60" cy="91" r="7.5" fill="#34d399" stroke="#fff" strokeWidth="2" />
                <path d="M56.4 91 l2.6 2.6 l4.6 -5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <ellipse cx="44" cy="103" rx="9" ry="5" fill="#1556c9" />
                <ellipse cx="76" cy="103" rx="9" ry="5" fill="#1556c9" />
            </svg>
        </div>
    );
}
