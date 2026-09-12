'use client';

import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Application, PipelineStage, PIPELINE_STAGES } from '@/lib/types';
import { KanbanColumn } from './KanbanColumn';
import { ApplicationCard } from './ApplicationCard';

interface KanbanBoardProps {
  applications: Application[];
  onStageChange: (applicationId: string, newStage: PipelineStage) => void;
  onApplicationClick?: (application: Application) => void;
  visibleStages?: PipelineStage[];
}

export function KanbanBoard({
  applications,
  onStageChange,
  onApplicationClick,
  visibleStages,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Configure sensors with distance threshold
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Determine which stages to show
  const stagesToShow = useMemo(() => {
    if (visibleStages && visibleStages.length > 0) {
      return PIPELINE_STAGES.filter((stage) =>
        visibleStages.includes(stage.value)
      );
    }
    // Default: show all active stages (hide withdrawn and rejected by default unless they have items)
    const hiddenByDefault: PipelineStage[] = ['withdrawn', 'rejected'];
    return PIPELINE_STAGES.filter(
      (stage) =>
        !hiddenByDefault.includes(stage.value) ||
        applications.some((app) => app.stage === stage.value)
    );
  }, [visibleStages, applications]);

  // Group applications by stage
  const applicationsByStage = useMemo(() => {
    const grouped: Record<PipelineStage, Application[]> = {
      saved: [],
      applied: [],
      oa: [],
      phone_screen: [],
      technical: [],
      onsite: [],
      team_match: [],
      offer: [],
      negotiating: [],
      accepted: [],
      rejected: [],
      withdrawn: [],
      ghosted: [],
    };

    applications.forEach((app) => {
      if (grouped[app.stage]) {
        grouped[app.stage].push(app);
      }
    });

    // Sort applications within each stage by last activity (most recent first)
    Object.keys(grouped).forEach((stage) => {
      grouped[stage as PipelineStage].sort((a, b) => {
        const aDate = new Date(a.last_activity || a.updated_at);
        const bDate = new Date(b.last_activity || b.updated_at);
        return bDate.getTime() - aDate.getTime();
      });
    });

    return grouped;
  }, [applications]);

  // Find active application for drag overlay
  const activeApplication = useMemo(() => {
    if (!activeId) return null;
    return applications.find((app) => app.id === activeId) || null;
  }, [activeId, applications]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string | null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);
    setOverId(null);

    if (!over) return;

    const activeAppId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column (stage)
    const isDroppedOnColumn = PIPELINE_STAGES.some(
      (stage) => stage.value === overId
    );

    if (isDroppedOnColumn) {
      const newStage = overId as PipelineStage;
      const activeApp = applications.find((app) => app.id === activeAppId);

      if (activeApp && activeApp.stage !== newStage) {
        onStageChange(activeAppId, newStage);
      }
    } else {
      // Dropped on another application - find its stage
      const targetApp = applications.find((app) => app.id === overId);
      if (targetApp) {
        const activeApp = applications.find((app) => app.id === activeAppId);
        if (activeApp && activeApp.stage !== targetApp.stage) {
          onStageChange(activeAppId, targetApp.stage);
        }
      }
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setOverId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 px-1">
        {stagesToShow.map((stage) => (
          <KanbanColumn
            key={stage.value}
            stage={stage.value}
            applications={applicationsByStage[stage.value]}
            onApplicationClick={onApplicationClick}
            isDraggingActive={!!activeId}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeApplication ? (
          <div className="rotate-3">
            <ApplicationCard
              application={activeApplication}
              isDragging={true}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
