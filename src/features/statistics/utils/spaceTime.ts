import { parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import type { Project, Space } from '@features/spaces/types'
import type { SpaceTime } from '../types/report'

export type SpaceTimeRow = {
  key: string
  spaceId: number | null
  name: string
  minutes: number
  child: boolean
}

/**
 * 기간 통계 bySpace(ADR-0030 §6)를 화면 줄로 바꾼다. 서버 순서를 지키고
 * 다시 정렬하거나 합치지 않는다. 스페이스 행 뒤에 그 프로젝트 행이 온다.
 */
export const spaceTimeRows = (
  bySpace: SpaceTime[] | undefined,
  spaces: Pick<Space, 'id' | 'name' | 'personal'>[],
  projects: Pick<Project, 'id' | 'name'>[],
): SpaceTimeRow[] =>
  (bySpace ?? []).flatMap((space) => [
    {
      key: `s${space.spaceId}`,
      spaceId: space.spaceId,
      name:
        spaces.find((item) => item.id === space.spaceId)?.name ??
        '알 수 없는 스페이스',
      minutes: parseIsoDurationMinutes(space.elapsed) ?? 0,
      child: false,
    },
    ...space.projects.map((project, index) => ({
      key: `s${space.spaceId}p${project.projectId ?? 'none'}-${index}`,
      spaceId: null,
      name:
        project.projectId === null
          ? '프로젝트 없음'
          : (projects.find((item) => item.id === project.projectId)?.name ??
            '삭제된 프로젝트'),
      minutes: parseIsoDurationMinutes(project.elapsed) ?? 0,
      child: true,
    })),
  ])
