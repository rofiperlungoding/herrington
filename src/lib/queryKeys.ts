export const queryKeys = {
  tasks: {
    all: ['tasks'] as const,
    list: () => ['tasks', 'list'] as const,
  },
  habits: {
    all: ['habits'] as const,
    list: () => ['habits', 'list'] as const,
  },
} as const
