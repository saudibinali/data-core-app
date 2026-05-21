import { Router, type IRouter, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { type AuthRequest, requireAuth } from "../middlewares/requireAuth";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload (authenticated, workspace-scoped).
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!req.workspaceId || !req.userId) {
    res.status(403).json({ error: "Workspace context required" });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { fileName, contentType, directory } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL(req.workspaceId);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    if (!objectStorageService.isObjectInWorkspace(objectPath, req.workspaceId)) {
      res.status(500).json({ error: "Upload path is not workspace-scoped" });
      return;
    }

    res.json(
      RequestUploadUrlResponse.parse({
        uploadUrl: uploadURL,
        objectPath,
        publicUrl: directory ? null : null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 */
router.get("/storage/public-objects/*filePath", async (req, res) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Private objects — requires auth, workspace path isolation, and ACL when set.
 */
router.get("/storage/objects/*path", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!req.userId || !req.workspaceId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    if (!objectStorageService.isObjectInWorkspace(objectPath, req.workspaceId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const aclPolicy = await getObjectAclPolicy(objectFile);

    if (aclPolicy) {
      const canAccess = await objectStorageService.canAccessObjectEntity({
        userId: String(req.userId),
        workspaceId: req.workspaceId,
        objectPath,
        objectFile,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
