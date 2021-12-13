import type { FirebaseError } from "@modules/firebase-errors-pt-br";
import { translateFirebaseError } from "@modules/firebase-errors-pt-br";
import type {
  Na3MaintenancePerson,
  Na3MaintenanceProject,
  Na3MaintenanceProjectStatus,
} from "@modules/na3-types";
import dayjs from "dayjs";
import { addDoc, arrayUnion, doc, updateDoc } from "firebase/firestore";
import { useCallback, useRef } from "react";

import type { FirebaseDocOperationResult } from "../types";
import type { MaintProjectBuilderData } from "../utils";
import {
  buildMaintProject,
  buildMaintProjectEvents,
  getCollection,
} from "../utils";
import { useStateSlice } from "./useStateSlice";

export type UseNa3MaintProjectsResult = {
  data: Na3MaintenanceProject[] | null;
  error: FirebaseError | null;
  helpers: {
    add: (
      internalId: number,
      projectData: MaintProjectBuilderData
    ) => Promise<FirebaseDocOperationResult<Omit<Na3MaintenanceProject, "id">>>;
    deliverProject: (
      projectId: string,
      eventData: { author: Na3MaintenancePerson; message?: string | null }
    ) => Promise<FirebaseDocOperationResult<Na3MaintenanceProject>>;
    formatInternalId: (internalId: number) => string;
    getById: (id: string) => Na3MaintenanceProject | undefined;
    getByStatus: (
      status: Na3MaintenanceProjectStatus | Na3MaintenanceProjectStatus[],
      data?: Na3MaintenanceProject[]
    ) => Na3MaintenanceProject[];
    getNextInternalId: () => number | undefined;
    getProjectStatus: (
      project: Na3MaintenanceProject
    ) => Na3MaintenanceProjectStatus;
    mapByStatus: (
      data?: Na3MaintenanceProject[]
    ) => Record<Na3MaintenanceProjectStatus, Na3MaintenanceProject[]>;
    shareProjectStatus: (
      projectId: string,
      eventData: { author: Na3MaintenancePerson; message: string }
    ) => Promise<FirebaseDocOperationResult<Na3MaintenanceProject>>;
    sortByPriority: (data?: Na3MaintenanceProject[]) => Na3MaintenanceProject[];
    sortByStatus: (
      sortingOrder: Na3MaintenanceProjectStatus[],
      data?: Na3MaintenanceProject[]
    ) => Na3MaintenanceProject[];
    update: (
      projectId: string,
      updateData: MaintProjectBuilderData &
        Pick<Na3MaintenanceProject, "internalId">
    ) => Promise<FirebaseDocOperationResult<Na3MaintenanceProject>>;
  };
  loading: boolean;
};

export function useNa3MaintProjects(): UseNa3MaintProjectsResult {
  const { environment } = useStateSlice("config");
  const maintProjects = useStateSlice("maintProjects");

  const fbCollectionRef = useRef(getCollection("manut-projects", environment));

  const getNextInternalId = useCallback((): number | undefined => {
    const lastId = maintProjects.data
      ?.map((project) => project.internalId)
      .sort((a, b) => a - b)
      .pop();
    return lastId ? lastId + 1 : undefined;
  }, [maintProjects.data]);

  const formatInternalId = useCallback((internalId: number): string => {
    return `PR-${internalId.toString().padStart(4, "0")}`;
  }, []);

  const getById = useCallback(
    (id: string): Na3MaintenanceProject | undefined =>
      maintProjects.data?.find((project) => project.id === id),
    [maintProjects.data]
  );

  const getProjectStatus = useCallback(
    (project: Na3MaintenanceProject): Na3MaintenanceProjectStatus => {
      if (project.events.map((ev) => ev.type).includes("complete")) {
        return "finished";
      } else if (dayjs(project.eta.toDate()).diff(dayjs()) < 0) {
        return "late";
      }
      return "running";
    },
    []
  );

  const getByStatus = useCallback(
    (
      status: Na3MaintenanceProjectStatus | Na3MaintenanceProjectStatus[],
      data?: Na3MaintenanceProject[]
    ): Na3MaintenanceProject[] => {
      const statusArr = typeof status === "string" ? [status] : status;
      return (
        (data || maintProjects.data)?.filter((project) =>
          statusArr.includes(getProjectStatus(project))
        ) || []
      );
    },
    [maintProjects.data, getProjectStatus]
  );

  const mapByStatus = useCallback(
    (
      data?: Na3MaintenanceProject[]
    ): Record<Na3MaintenanceProjectStatus, Na3MaintenanceProject[]> => {
      return {
        finished: getByStatus("finished", data),
        late: getByStatus("late", data),
        running: getByStatus("running", data),
      };
    },
    [getByStatus]
  );

  const sortByStatus = useCallback(
    (
      sortingOrder: Na3MaintenanceProjectStatus[],
      data?: Na3MaintenanceProject[]
    ): Na3MaintenanceProject[] => {
      const statusMap = mapByStatus(data);
      return sortingOrder.flatMap((status) =>
        [...statusMap[status]].sort((a, b) => b.internalId - a.internalId)
      );
    },
    [mapByStatus]
  );

  const sortByPriority = useCallback(
    (data?: Na3MaintenanceProject[]) => {
      const priorityMap: Record<Na3MaintenanceProject["priority"], number> = {
        high: 3,
        low: 1,
        medium: 2,
      };
      return (data || maintProjects.data || []).sort(
        (a, b) => priorityMap[b.priority] - priorityMap[a.priority]
      );
    },
    [maintProjects.data]
  );

  const addProject = useCallback(
    async (internalId: number, projectData: MaintProjectBuilderData) => {
      const project = buildMaintProject(internalId, projectData);

      try {
        const docRef = await addDoc(fbCollectionRef.current, project);

        return { data: docRef, error: null };
      } catch (err) {
        return {
          data: null,
          error: translateFirebaseError(err as FirebaseError),
        };
      }
    },
    []
  );

  const shareProjectStatus = useCallback(
    async (
      projectId: string,
      eventData: { author: Na3MaintenancePerson; message: string }
    ) => {
      const ev = buildMaintProjectEvents({
        author: eventData.author,
        message: eventData.message,
        type: "status",
      });

      try {
        const docRef = doc(fbCollectionRef.current, projectId);

        await updateDoc(docRef, { events: arrayUnion(ev) });

        return { data: docRef, error: null };
      } catch (err) {
        return {
          data: null,
          error: translateFirebaseError(err as FirebaseError),
        };
      }
    },
    []
  );

  const deliverProject = useCallback(
    async (
      projectId: string,
      eventData: { author: Na3MaintenancePerson; message?: string | null }
    ) => {
      const ev = buildMaintProjectEvents({
        author: eventData.author,
        message: eventData.message || null,
        type: "complete",
      });

      try {
        const docRef = doc(fbCollectionRef.current, projectId);

        await updateDoc(docRef, { events: arrayUnion(ev) });

        return { data: docRef, error: null };
      } catch (err) {
        return {
          data: null,
          error: translateFirebaseError(err as FirebaseError),
        };
      }
    },
    []
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      updateData: MaintProjectBuilderData &
        Pick<Na3MaintenanceProject, "internalId">
    ) => {
      const updated = buildMaintProject(updateData.internalId, updateData, {
        skipEvents: true,
      });

      const ev = buildMaintProjectEvents({
        author: updateData.author,
        type: "edit",
      });

      try {
        const docRef = doc(fbCollectionRef.current, projectId);

        const projectToUpdate = getById(projectId);

        if (
          projectToUpdate &&
          projectToUpdate.events[0].author !== updateData.author
        ) {
          await updateDoc(docRef, {
            ...updated,
            isPredPrev: updated.isPredPrev || undefined,
            events: [
              buildMaintProjectEvents({
                type: "create",
                author: updateData.author,
              }),
              ...projectToUpdate.events.slice(1),
            ],
          });
        } else {
          await updateDoc(docRef, {
            ...updated,
            isPredPrev: updated.isPredPrev || undefined,
            events: arrayUnion(ev),
          });
        }

        return { data: docRef, error: null };
      } catch (err) {
        return {
          data: null,
          error: translateFirebaseError(err as FirebaseError),
        };
      }
    },
    [getById]
  );

  return {
    ...maintProjects,
    helpers: {
      add: addProject,
      deliverProject,
      formatInternalId,
      getById,
      getByStatus,
      getNextInternalId,
      getProjectStatus,
      mapByStatus,
      shareProjectStatus,
      sortByPriority,
      sortByStatus,
      update: updateProject,
    },
  };
}
