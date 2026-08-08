import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 컨테이너 이미지를 작게 유지하려고 실행에 필요한 것만 추려 담는다
  output: "standalone",
};

export default nextConfig;
