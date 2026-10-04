import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playlistRouter from "./playlists";
import songAnalysisRouter from "./song-analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playlistRouter);
router.use(songAnalysisRouter);

export default router;
