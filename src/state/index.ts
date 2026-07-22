export {
  CourseDatabase,
  LessonStatus,
  VideoType,
  extractCommunitySlug,
  isSkoolUrl,
  getDbDir,
  getDbPath,
  type CourseMetadata,
  type LessonRecord,
  type LessonStatusType,
  type LessonWithModule,
  type ModuleRecord,
  type VideoTypeValue,
} from "./database.js";

export {
  getCourseStateKey,
  initializeCourseState,
  persistCourseStateStructure,
  markLessonFailure,
  markLessonScanReady,
  recordVideoDownloadResult,
  type CourseStateLesson,
  type CourseStateModule,
  type CourseStateStructure,
  type InitializedCourseState,
  type InitializeCourseStateOptions,
} from "./courseState.js";
