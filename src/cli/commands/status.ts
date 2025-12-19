import chalk from "chalk";
import {
  CourseDatabase,
  extractCommunitySlug,
  LessonStatus,
  getDbPath,
} from "../../state/index.js";
import { existsSync } from "node:fs";

export interface StatusOptions {
  errors?: boolean;
  pending?: boolean;
  all?: boolean;
}

/**
 * Handles the status command.
 * Shows the current sync state for a course.
 */
export function statusCommand(url: string, options: StatusOptions): void {
  console.log(chalk.blue("\n📊 Course Status\n"));

  // Validate URL
  if (!url.includes("skool.com")) {
    console.log(chalk.red("❌ Invalid URL. Please provide a Skool URL."));
    process.exit(1);
  }

  const communitySlug = extractCommunitySlug(url);
  const dbPath = getDbPath(communitySlug);

  if (!existsSync(dbPath)) {
    console.log(chalk.yellow(`   No sync state found for: ${communitySlug}`));
    console.log(chalk.gray(`   Run 'offcourse sync ${url}' to start syncing.\n`));
    return;
  }

  const db = new CourseDatabase(communitySlug);

  try {
    const meta = db.getCourseMetadata();
    const summary = db.getStatusSummary();

    console.log(chalk.white(`   Course: ${meta.name}`));
    console.log(chalk.gray(`   URL: ${meta.url}`));
    console.log(chalk.gray(`   Last sync: ${meta.lastSyncAt ?? "never"}`));
    console.log();
    console.log(chalk.gray(`   Modules: ${meta.totalModules}`));
    console.log(chalk.gray(`   Lessons: ${meta.totalLessons}`));
    console.log();
    console.log(chalk.green(`   ✅ Downloaded:        ${summary.downloaded}`));
    if (summary.validated > 0) {
      console.log(chalk.blue(`   ⬇️  Ready to download: ${summary.validated}`));
    }
    if (summary.pending > 0) {
      console.log(chalk.gray(`   🔍 Not scanned yet:   ${summary.pending}`));
    }
    if (summary.skipped > 0) {
      console.log(chalk.gray(`   ➖ No video:          ${summary.skipped}`));
    }
    if (summary.error > 0) {
      console.log(chalk.red(`   ❌ Failed:            ${summary.error}`));
    }

    // Show error details if requested
    if (options.errors || options.all) {
      const errorLessons = db.getLessonsByStatus(LessonStatus.ERROR);
      if (errorLessons.length > 0) {
        console.log(chalk.red("\n   ❌ Failed Lessons:\n"));
        for (const lesson of errorLessons) {
          console.log(chalk.red(`   • ${lesson.moduleName} > ${lesson.name}`));
          if (lesson.errorMessage) {
            console.log(chalk.gray(`     ${lesson.errorMessage}`));
          }
          if (lesson.errorCode) {
            console.log(chalk.gray(`     Code: ${lesson.errorCode}`));
          }
        }
      }
    }

    // Show not-scanned details if requested
    if (options.pending || options.all) {
      const pendingLessons = db.getLessonsByStatus(LessonStatus.PENDING);
      if (pendingLessons.length > 0) {
        console.log(chalk.yellow("\n   🔍 Not Yet Scanned:\n"));
        let currentModule = "";
        for (const lesson of pendingLessons) {
          if (lesson.moduleName !== currentModule) {
            currentModule = lesson.moduleName;
            console.log(chalk.blue(`\n   📖 ${currentModule}`));
          }
          console.log(chalk.gray(`      • ${lesson.name}`));
        }
      }
    }

    console.log();
  } finally {
    db.close();
  }
}

/**
 * List all synced courses.
 */
export async function statusListCommand(): Promise<void> {
  console.log(chalk.blue("\n📚 Synced Courses\n"));

  const { getDbDir } = await import("../../state/index.js");
  const { readdirSync } = await import("node:fs");

  const dbDir = getDbDir();

  if (!existsSync(dbDir)) {
    console.log(chalk.gray("   No courses synced yet.\n"));
    return;
  }

  const files = readdirSync(dbDir).filter((f) => f.endsWith(".db"));

  if (files.length === 0) {
    console.log(chalk.gray("   No courses synced yet.\n"));
    return;
  }

  for (const file of files) {
    const slug = file.replace(".db", "");
    const db = new CourseDatabase(slug);

    try {
      const meta = db.getCourseMetadata();
      const summary = db.getStatusSummary();

      console.log(chalk.white(`   ${meta.name || slug}`));
      console.log(chalk.gray(`   └─ ${summary.downloaded}/${meta.totalLessons} downloaded`));

      if (summary.error > 0) {
        console.log(chalk.red(`      ${summary.error} errors`));
      }
      console.log();
    } finally {
      db.close();
    }
  }
}

