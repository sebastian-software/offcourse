import type { Page } from "playwright";

export interface HighLevelCourse {
  id: string;
  title: string;
  description: string;
  slug: string;
  thumbnailUrl: string | null;
  instructor: string | null;
  totalLessons: number;
  progress: number;
}

export interface HighLevelCategory {
  id: string;
  title: string;
  description: string | null;
  position: number;
  postCount: number;
  isLocked: boolean;
}

export interface HighLevelPost {
  id: string;
  title: string;
  position: number;
  categoryId: string;
  isLocked: boolean;
  isCompleted: boolean;
}

export interface HighLevelCourseStructure {
  course: HighLevelCourse;
  categories: Array<HighLevelCategory & { posts: HighLevelPost[] }>;
  locationId: string;
  domain: string;
}

export interface HighLevelScanProgress {
  phase: "init" | "course" | "categories" | "posts" | "done";
  courseName?: string;
  totalCategories?: number;
  currentCategory?: string;
  currentCategoryIndex?: number;
  postsFound?: number;
  skippedLocked?: boolean;
}

// Browser/API automation - requires Playwright
/* v8 ignore start */

/**
 * Extracts the location ID from the HighLevel portal.
 * The location ID is used in all API calls.
 */
export async function extractLocationId(page: Page): Promise<string | null> {
  // Wait for API calls that contain the location ID
  const locationId = await page.evaluate(() => {
    // Try to find it in the URL of any API call
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const script of scripts) {
      const content = script.textContent ?? "";
      // Look for location ID pattern in HighLevel (typically in API URLs)
      const match = /locations\/([A-Za-z0-9]+)/.exec(content);
      if (match?.[1] && match[1].length > 10) {
        return match[1];
      }
    }

    // Try to find it in localStorage or sessionStorage
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) {
          const value = storage.getItem(key);
          if (value) {
            const match = /"locationId":\s*"([A-Za-z0-9]+)"/.exec(value);
            if (match?.[1]) return match[1];
          }
        }
      }
    }

    return null;
  });

  return locationId;
}

/**
 * Extracts portal settings including location ID from the API.
 */
export async function extractPortalSettings(
  page: Page,
  domain: string
): Promise<{ locationId: string; portalName: string } | null> {
  try {
    // Intercept the portal-settings API call
    const response = await page.evaluate(async (domain) => {
      const res = await fetch(
        `https://services.leadconnectorhq.com/clientclub/portal-settings?domain=${domain}`
      );
      if (!res.ok) return null;
      return res.json();
    }, domain);

    if (response?.locationId) {
      return {
        locationId: response.locationId,
        portalName: response.portalName ?? response.name ?? "HighLevel Course",
      };
    }
  } catch {
    // Fall through
  }

  return null;
}

/**
 * Extracts course list from the courses library page.
 */
export async function extractCourses(page: Page): Promise<HighLevelCourse[]> {
  // Wait for the course cards to load
  await page.waitForTimeout(2000);

  const courses = await page.evaluate(() => {
    const results: HighLevelCourse[] = [];

    // Find course cards - HighLevel uses various patterns
    const courseCards = document.querySelectorAll(
      '[class*="course-card"], [class*="CourseCard"], [data-product-id], [class*="product-card"]'
    );

    // If no specific cards found, try to find links to course pages
    if (courseCards.length === 0) {
      const courseLinks = document.querySelectorAll('a[href*="/courses/products/"]');
      const seen = new Set<string>();

      courseLinks.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        const match = /\/courses\/products\/([a-f0-9-]+)/.exec(href);
        if (match?.[1] && !seen.has(match[1])) {
          seen.add(match[1]);
          const title =
            link.querySelector("h3, h4, [class*='title']")?.textContent?.trim() ||
            link.textContent?.trim() ||
            `Course ${results.length + 1}`;

          results.push({
            id: match[1],
            title,
            description: "",
            slug: match[1],
            thumbnailUrl: link.querySelector("img")?.src ?? null,
            instructor: null,
            totalLessons: 0,
            progress: 0,
          });
        }
      });
    }

    return results;
  });

  return courses;
}

/**
 * Extracts course details from the course overview page via API.
 */
export async function extractCourseDetails(
  page: Page,
  courseUrl: string,
  locationId?: string
): Promise<HighLevelCourse | null> {
  // Extract product ID from provided courseUrl first
  let productId: string | undefined;

  const courseUrlMatch = /\/courses\/products\/([a-f0-9-]+)/.exec(courseUrl);
  if (courseUrlMatch?.[1]) {
    productId = courseUrlMatch[1];
  }

  // Fallback: try from current page URL
  if (!productId) {
    const pageUrlMatch = /\/courses\/products\/([a-f0-9-]+)/.exec(page.url());
    productId = pageUrlMatch?.[1];
  }

  if (!productId) {
    console.error("Could not extract product ID from URL:", courseUrl, "page:", page.url());
    return null;
  }

  // Try direct API call first (most reliable)
  if (locationId) {
    try {
      const apiUrl = `https://services.leadconnectorhq.com/membership/locations/${locationId}/products/${productId}`;

      // Get auth token from the page context
      const authToken = await page.evaluate(() => {
        const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
        const tokenData = tokenKey ? JSON.parse(localStorage.getItem(tokenKey) ?? "{}") : null;
        return tokenData?.stsTokenManager?.accessToken ?? null;
      });

      if (authToken) {
        // Use page.request to make the API call (bypasses CORS)
        const response = await page.request.get(apiUrl, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (response.ok()) {
          const data = await response.json();
          // The API returns the product directly, not wrapped in a "product" property
          const product = data.product ?? data;
          const title = product.title;
          if (title && title !== "Unknown Course") {
            return {
              id: product.id ?? productId,
              title,
              description: product.description ?? "",
              slug: product.id ?? productId,
              thumbnailUrl: product.posterImage ?? null,
              instructor: product.instructor ?? null,
              totalLessons: product.postCount ?? 0,
              progress: 0,
            };
          }
        }
      }
    } catch {
      // Continue to DOM fallback silently
    }
  }

  // Fallback to DOM extraction if API fails
  const domCourse = await page.evaluate(() => {
    const urlMatch = /\/courses\/products\/([a-f0-9-]+)/.exec(window.location.href);
    const id = urlMatch?.[1] ?? "";

    // Look for the course title in various places
    let title = "";

    // Method 1: Look for a large heading that's not navigation
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    for (const h of headings) {
      const text = h.textContent?.trim() ?? "";
      const parent = h.closest("nav, header, [class*='nav'], [class*='Nav']");
      // Skip if in navigation, or if it's a generic title
      if (parent) continue;
      if (text.length < 4) continue;
      if (text.toLowerCase().includes("menu")) continue;
      if (text.toLowerCase().includes("login")) continue;
      if (text === "HighLevel") continue;
      if (text === "Courses") continue;

      // Found a good candidate
      title = text;
      break;
    }

    // Method 2: Look for text with "lesson" count indicator nearby
    if (!title) {
      const lessonIndicators = Array.from(
        document.querySelectorAll("[class*='lesson'], [class*='Lesson']")
      );
      for (const indicator of lessonIndicators) {
        const parent = indicator.closest(
          "[class*='card'], [class*='Card'], [class*='product'], [class*='Product']"
        );
        if (parent) {
          const heading = parent.querySelector("h1, h2, h3, h4");
          if (heading?.textContent?.trim()) {
            title = heading.textContent.trim();
            break;
          }
        }
      }
    }

    if (!title || title.length < 3) {
      title = "Unknown Course";
    }

    return {
      id,
      title,
      description: "",
      slug: id,
      thumbnailUrl: null,
      instructor: null,
      totalLessons: 0,
      progress: 0,
    };
  });

  return domCourse.id ? domCourse : null;
}

/**
 * Extracts categories (modules) from a course page.
 */
export async function extractCategories(
  page: Page,
  productId: string,
  locationId: string
): Promise<HighLevelCategory[]> {
  // Try to get categories via API
  const categories = await page.evaluate(
    async ({ productId, locationId }) => {
      try {
        // Get auth token from Firebase
        const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
        const tokenData = tokenKey ? JSON.parse(localStorage.getItem(tokenKey) ?? "{}") : null;
        const token = tokenData?.stsTokenManager?.accessToken;

        if (!token) {
          console.warn("No auth token found");
          return [];
        }

        const res = await fetch(
          `https://services.leadconnectorhq.com/membership/locations/${locationId}/user-purchase/categories?product_id=${productId}&source=courses`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          console.warn("Categories API returned", res.status);
          return [];
        }

        const data = await res.json();

        if (Array.isArray(data.categories)) {
          return data.categories.map(
            (cat: {
              id: string;
              title: string;
              description?: string;
              position?: number;
              postCount?: number;
              visibility?: string;
            }) => ({
              id: cat.id,
              title: cat.title,
              description: cat.description ?? null,
              position: cat.position ?? 0,
              postCount: cat.postCount ?? 0,
              isLocked: cat.visibility === "locked",
            })
          );
        }

        return [];
      } catch (error) {
        console.error("Failed to fetch categories:", error);
        return [];
      }
    },
    { productId, locationId }
  );

  return categories;
}

/**
 * Extracts posts (lessons) from a category.
 */
export async function extractPosts(
  page: Page,
  productId: string,
  categoryId: string,
  locationId: string
): Promise<HighLevelPost[]> {
  const posts = await page.evaluate(
    async ({ productId, categoryId, locationId }) => {
      try {
        // Get auth token
        const tokenKey = Object.keys(localStorage).find((k) => k.includes("firebase:authUser"));
        const tokenData = tokenKey ? JSON.parse(localStorage.getItem(tokenKey) ?? "{}") : null;
        const token = tokenData?.stsTokenManager?.accessToken;

        if (!token) {
          return [];
        }

        const res = await fetch(
          `https://services.leadconnectorhq.com/membership/locations/${locationId}/user-purchase/categories/${categoryId}?product_id=${productId}&visibility=published&published_posts=true&source=courses`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          return [];
        }

        const data = await res.json();

        if (data.category?.posts && Array.isArray(data.category.posts)) {
          return data.category.posts.map(
            (
              post: {
                id: string;
                title: string;
                indexPosition?: number;
                visibility?: string;
              },
              index: number
            ) => ({
              id: post.id,
              title: post.title,
              position: post.indexPosition ?? index,
              categoryId,
              isLocked: post.visibility === "locked",
              isCompleted: false,
            })
          );
        }

        return [];
      } catch (error) {
        console.error("Failed to fetch posts:", error);
        return [];
      }
    },
    { productId, categoryId, locationId }
  );

  return posts;
}

/**
 * Builds the complete course structure.
 */
export async function buildHighLevelCourseStructure(
  page: Page,
  courseUrl: string,
  onProgress?: (progress: HighLevelScanProgress) => void
): Promise<HighLevelCourseStructure | null> {
  // Extract domain and product ID from URL
  const urlObj = new URL(courseUrl);
  const domain = urlObj.hostname;
  const productMatch = /\/courses\/products\/([a-f0-9-]+)/.exec(courseUrl);
  const productId = productMatch?.[1];

  // Get portal settings (includes location ID)
  onProgress?.({ phase: "init" });

  let locationId: string | null = null;

  // Try to get location ID from portal settings API
  const settings = await extractPortalSettings(page, domain);
  if (settings) {
    locationId = settings.locationId;
  }

  // Fallback: try to extract from page
  if (!locationId) {
    locationId = await extractLocationId(page);
  }

  if (!locationId) {
    console.error("Could not determine location ID");
    return null;
  }

  // Set up response interception to capture product data BEFORE navigation
  let capturedCourseTitle: string | null = null;

  const responseHandler = async (response: import("playwright").Response) => {
    const url = response.url();
    if (
      productId &&
      url.includes(`/products/${productId}`) &&
      url.includes("leadconnectorhq.com")
    ) {
      try {
        const data = await response.json();
        if (data.product?.title) {
          capturedCourseTitle = data.product.title;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  };

  page.on("response", responseHandler);

  // Navigate to course page (force reload to ensure we capture API responses)
  // Using waitUntil: "networkidle" to ensure all API calls complete
  await page.goto(courseUrl, {
    timeout: 30000,
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1000);

  // Remove the handler
  page.off("response", responseHandler);

  // Extract course details
  onProgress?.({ phase: "course" });
  const course = await extractCourseDetails(page, courseUrl, locationId);

  if (!course) {
    console.error("Could not extract course details");
    return null;
  }

  // Use captured title if available and course title is unknown
  if (capturedCourseTitle && (course.title === "Unknown Course" || !course.title)) {
    course.title = capturedCourseTitle;
  }

  // Fallback: Try to get title from DOM after page is fully loaded
  if (course.title === "Unknown Course" || !course.title) {
    const domTitle = await page.evaluate(() => {
      // Look for product title in common HighLevel selectors
      const selectors = [
        "[class*='product-title']",
        "[class*='ProductTitle']",
        "[class*='course-title']",
        "[class*='CourseTitle']",
        "h1.title",
        "h2.title",
        "[data-testid='product-title']",
        ".product-header h1",
        ".product-header h2",
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const text = el?.textContent?.trim();
        if (text && text.length > 2 && text.length < 200) {
          return text;
        }
      }

      // Try to find a heading that's not generic
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
      for (const h of headings) {
        const text = h.textContent?.trim() ?? "";
        if (
          text.length > 3 &&
          text.length < 150 &&
          !text.toLowerCase().includes("menu") &&
          !text.toLowerCase().includes("login") &&
          text !== "Memberships" &&
          text !== "Courses" &&
          text !== "Unknown Course"
        ) {
          return text;
        }
      }

      return null;
    });

    if (domTitle) {
      course.title = domTitle;
    }
  }

  onProgress?.({ phase: "course", courseName: course.title });

  // Extract categories
  onProgress?.({ phase: "categories" });
  const categories = await extractCategories(page, course.id, locationId);

  onProgress?.({ phase: "categories", totalCategories: categories.length });

  // Extract posts for each category
  const categoriesWithPosts: HighLevelCourseStructure["categories"] = [];

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i]!;

    if (category.isLocked) {
      onProgress?.({
        phase: "posts",
        currentCategory: category.title,
        currentCategoryIndex: i,
        skippedLocked: true,
      });
      continue;
    }

    onProgress?.({
      phase: "posts",
      currentCategory: category.title,
      currentCategoryIndex: i,
    });

    const posts = await extractPosts(page, course.id, category.id, locationId);

    onProgress?.({
      phase: "posts",
      currentCategory: category.title,
      currentCategoryIndex: i,
      postsFound: posts.length,
    });

    categoriesWithPosts.push({
      ...category,
      posts,
    });
  }

  onProgress?.({ phase: "done" });

  // Update total lessons count
  course.totalLessons = categoriesWithPosts.reduce((total, cat) => total + cat.posts.length, 0);

  return {
    course,
    categories: categoriesWithPosts,
    locationId,
    domain,
  };
}
/* v8 ignore stop */

// Re-export shared utilities for backwards compatibility
export { slugify, createFolderName } from "../../shared/slug.js";

/**
 * Constructs the URL for a HighLevel course page.
 */
export function getHighLevelCourseUrl(domain: string, productId: string): string {
  return `https://${domain}/courses/products/${productId}?source=courses`;
}

/**
 * Constructs the URL for a HighLevel lesson (post) page.
 */
export function getHighLevelPostUrl(
  domain: string,
  productId: string,
  categoryId: string,
  postId: string
): string {
  return `https://${domain}/courses/products/${productId}/categories/${categoryId}/posts/${postId}?source=courses`;
}
