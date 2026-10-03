import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playlistRouter from "./playlists";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playlistRouter);

export default router;
