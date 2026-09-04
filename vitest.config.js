import { defineConfig } from 'vitest/config';

// 单元测试只覆盖确定性逻辑（AGENTS.md：模拟、校验、序列化），环境固定为 node。
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
