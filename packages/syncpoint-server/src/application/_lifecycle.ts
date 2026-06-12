import { InvalidStateTransitionError } from "syncpoint-kernel";

export interface StatusTransitionSpec<TEntity, TStatus extends string, TResult = TEntity> {
  entityName: string;
  entityId: string;
  actionLabel?: string;
  currentStatus: TStatus;
  targetStatus: TStatus;
  canTransition: (currentStatus: TStatus, targetStatus: TStatus) => boolean;
  transition: () => TEntity;
  onTransition?: (entity: TEntity) => void;
  buildResult?: (entity: TEntity) => TResult;
}

export function applyStatusTransition<TEntity, TStatus extends string, TResult = TEntity>(
  spec: StatusTransitionSpec<TEntity, TStatus, TResult>,
): TResult {
  if (!spec.canTransition(spec.currentStatus, spec.targetStatus)) {
    throw new InvalidStateTransitionError(spec.entityName, spec.currentStatus, spec.targetStatus);
  }

  const entity = spec.transition();
  spec.onTransition?.(entity);

  if (spec.buildResult) {
    return spec.buildResult(entity);
  }

  return entity as unknown as TResult;
}
