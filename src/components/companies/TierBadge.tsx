import { Tier, TIER_COLORS, TIER_LABELS } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';

interface TierBadgeProps {
  tier: Tier | string;
}

export function TierBadge({ tier }: TierBadgeProps) {
  const tierKey = tier as Tier;
  const color = TIER_COLORS[tierKey] || 'bg-gray-600';
  const label = TIER_LABELS[tierKey] || tier;

  return <Badge className={color}>{label}</Badge>;
}
