export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ChatUK Backend API',
    version: '1.0.0',
    description:
      'API documentation for ChatUK — a secure, end-to-end encrypted (E2EE) mobile chat and calling application built with React Native (Expo) and Node.js Express.',
    contact: {
      name: 'ChatUK Team',
      email: 'support@chatuk.local',
    },
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Local development server',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication and session management via Better-Auth' },
    { name: 'User & Profile', description: 'User profile, avatar management, theme, and privacy controls' },
    { name: 'Messages & Conversations', description: '1-on-1 direct conversations, chat history, reactions, and media' },
    { name: 'Group Chats', description: 'Group creation, participant management, and admin roles' },
    { name: 'E2EE & Devices', description: 'Signal-style multi-device key exchange, active devices, and zero-knowledge cloud backups' },
    { name: 'Uploads', description: 'Direct Cloudinary signed uploads and media handling' },
    { name: 'Contact', description: 'Contact form and user feedback submissions' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT / Session Token',
        description: 'Provide your session token as a Bearer token in the `Authorization` header.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description: 'Better Auth session cookie.',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation completed successfully' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Invalid request payload' },
          code: { type: 'string', example: 'BAD_REQUEST' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720f4c330df32091219b451' },
          name: { type: 'string', example: 'Jane Doe' },
          email: { type: 'string', example: 'jane@example.com' },
          image: { type: 'string', nullable: true, example: 'https://res.cloudinary.com/chatuk/image/upload/v1/avatar.jpg' },
          bio: { type: 'string', nullable: true, example: 'Hey there! I am using ChatUK.' },
          theme: { type: 'string', enum: ['light', 'dark', 'system'], example: 'system' },
          wallpaper: { type: 'string', nullable: true, example: 'default' },
        },
      },
      Conversation: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720f4c330df32091219b452' },
          type: { type: 'string', enum: ['direct', 'group'], example: 'direct' },
          participants: {
            type: 'array',
            items: { $ref: '#/components/schemas/User' },
          },
          status: { type: 'string', enum: ['pending', 'accepted', 'denied'], example: 'accepted' },
          lastMessage: {
            type: 'object',
            properties: {
              ciphertext: { type: 'string', example: 'Encrypted message ciphertext' },
              createdAt: { type: 'string', format: 'date-time' },
              senderId: { type: 'string' },
            },
          },
          unreadCount: { type: 'integer', example: 0 },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720f4c330df32091219b453' },
          conversationId: { type: 'string', example: '6720f4c330df32091219b452' },
          senderId: { type: 'string', example: '6720f4c330df32091219b451' },
          ciphertext: { type: 'string', description: 'AES-GCM / Libsodium encrypted message ciphertext' },
          nonce: { type: 'string', description: 'Base64 encoded initialization vector / nonce' },
          messageType: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'file'], example: 'text' },
          mediaUrl: { type: 'string', nullable: true },
          reactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                emoji: { type: 'string', example: '👍' },
                userId: { type: 'string' },
              },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720f4c330df32091219b454' },
          deviceId: { type: 'string', example: 'uuid-device-1234' },
          signPublicKey: { type: 'string', example: 'base64-ed25519-public-key' },
          boxPublicKey: { type: 'string', example: 'base64-x25519-public-key' },
          registeredAt: { type: 'string', format: 'date-time' },
        },
      },
      Group: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '6720f4c330df32091219b455' },
          name: { type: 'string', example: 'Design Guild' },
          description: { type: 'string', example: 'ChatUK UI/UX & Design discussions' },
          avatarUrl: { type: 'string', nullable: true },
          creator: { type: 'string', example: '6720f4c330df32091219b451' },
          admins: {
            type: 'array',
            items: { type: 'string' },
          },
          participants: {
            type: 'array',
            items: { $ref: '#/components/schemas/User' },
          },
          memberCount: { type: 'integer', example: 4 },
        },
      },
      CloudBackup: {
        type: 'object',
        properties: {
          ciphertext: { type: 'string', description: 'Zero-knowledge encrypted key vault' },
          nonce: { type: 'string' },
          salt: { type: 'string' },
          version: { type: 'integer', example: 1 },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    // -------------------------------------------------------------------------
    // AUTHENTICATION (Better-Auth)
    // -------------------------------------------------------------------------
    '/api/auth/sign-up/email': {
      post: {
        tags: ['Auth'],
        summary: 'Register with email & password',
        description: 'Creates a new user account with email and password via Better Auth.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'alice@example.com' },
                  password: { type: 'string', format: 'password', example: 'SecurePassword123!' },
                  name: { type: 'string', example: 'Alice Smith' },
                  image: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'User registered successfully and session created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                    token: { type: 'string' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error or email already in use' },
        },
      },
    },
    '/api/auth/sign-in/email': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with email & password',
        description: 'Authenticates user and returns active session token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'alice@example.com' },
                  password: { type: 'string', format: 'password', example: 'SecurePassword123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Successfully authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                    token: { type: 'string' },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid email or password' },
        },
      },
    },
    '/api/auth/get-session': {
      get: {
        tags: ['Auth'],
        summary: 'Get current session',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Returns the currently authenticated user and active session metadata.',
        responses: {
          200: {
            description: 'Active session info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                    session: { type: 'object' },
                  },
                },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/api/auth/sign-out': {
      post: {
        tags: ['Auth'],
        summary: 'Log out',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Terminates active session and clears cookies/tokens.',
        responses: {
          200: {
            description: 'Successfully logged out',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
        },
      },
    },

    // -------------------------------------------------------------------------
    // USER & PROFILE
    // -------------------------------------------------------------------------
    '/api/user/profile': {
      get: {
        tags: ['User & Profile'],
        summary: 'Get authenticated user profile',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Fetches full profile attributes for the logged-in user.',
        responses: {
          200: {
            description: 'User profile details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/profile-picture': {
      post: {
        tags: ['User & Profile'],
        summary: 'Upload profile picture',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Upload avatar image (multipart form-data or base64) to Cloudinary.',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  image: { type: 'string', format: 'binary', description: 'Avatar image file (JPEG, PNG, WebP up to 10MB)' },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  image: { type: 'string', description: 'Base64 image string or data URI' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Profile picture updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Profile picture updated successfully' },
                    imageUrl: { type: 'string', example: 'https://res.cloudinary.com/.../avatar.jpg' },
                  },
                },
              },
            },
          },
          400: { description: 'Missing or invalid image file' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      delete: {
        tags: ['User & Profile'],
        summary: 'Delete profile picture',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Deletes current profile picture and reverts user avatar to default initial.',
        responses: {
          200: {
            description: 'Profile picture removed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Profile picture deleted successfully' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/theme': {
      put: {
        tags: ['User & Profile'],
        summary: 'Update theme preference',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['theme'],
                properties: {
                  theme: { type: 'string', enum: ['light', 'dark', 'system'], example: 'dark' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Theme updated successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/bio': {
      put: {
        tags: ['User & Profile'],
        summary: 'Update user bio',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bio'],
                properties: {
                  bio: { type: 'string', maxLength: 160, example: 'Coding mobile apps with React Native!' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Bio updated successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/wallpaper': {
      put: {
        tags: ['User & Profile'],
        summary: 'Update chat wallpaper',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['wallpaper'],
                properties: {
                  wallpaper: { type: 'string', example: 'doodle_pattern_dark' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Wallpaper updated successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/block': {
      post: {
        tags: ['User & Profile'],
        summary: 'Block a user',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['targetUserId'],
                properties: {
                  targetUserId: { type: 'string', example: '6720f4c330df32091219b456' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'User blocked successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/unblock': {
      post: {
        tags: ['User & Profile'],
        summary: 'Unblock a user',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['targetUserId'],
                properties: {
                  targetUserId: { type: 'string', example: '6720f4c330df32091219b456' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'User unblocked successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/user/blocked': {
      get: {
        tags: ['User & Profile'],
        summary: 'Get blocked users list',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: {
            description: 'List of blocked user profiles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    blockedUsers: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // MESSAGES & CONVERSATIONS
    // -------------------------------------------------------------------------
    '/api/messages/conversations': {
      get: {
        tags: ['Messages & Conversations'],
        summary: 'Get all conversations',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Returns all direct and group conversations for the authenticated user, ordered by last activity.',
        responses: {
          200: {
            description: 'Conversation list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Conversation' },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Messages & Conversations'],
        summary: 'Create or find direct conversation',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Finds an existing 1:1 conversation with a user by email, or creates a new conversation request.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'bob@example.com' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Found or created conversation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    conversation: { $ref: '#/components/schemas/Conversation' },
                    isNew: { type: 'boolean' },
                  },
                },
              },
            },
          },
          400: { description: 'Missing email or self-chat attempt' },
          404: { description: 'Target user does not exist' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/conversations/{id}': {
      get: {
        tags: ['Messages & Conversations'],
        summary: 'Get conversation details',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Conversation ID' },
        ],
        responses: {
          200: {
            description: 'Conversation detail',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Conversation' },
              },
            },
          },
          404: { description: 'Conversation not found' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      delete: {
        tags: ['Messages & Conversations'],
        summary: 'Delete conversation',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Conversation deleted' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/conversations/{id}/accept': {
      post: {
        tags: ['Messages & Conversations'],
        summary: 'Accept conversation request',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Conversation accepted' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/conversations/{id}/deny': {
      post: {
        tags: ['Messages & Conversations'],
        summary: 'Deny conversation request',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Conversation request denied' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/conversations/{id}/clear': {
      post: {
        tags: ['Messages & Conversations'],
        summary: 'Clear conversation message history',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Message history cleared for user' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/conversations/{id}/media': {
      get: {
        tags: ['Messages & Conversations'],
        summary: 'Get conversation media attachments',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Media items in conversation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    media: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          mediaUrl: { type: 'string' },
                          messageType: { type: 'string' },
                          createdAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/conversations/{id}/messages': {
      get: {
        tags: ['Messages & Conversations'],
        summary: 'Get paginated conversation messages',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Conversation ID' },
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Pagination cursor timestamp or ID' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 }, description: 'Number of messages to fetch' },
        ],
        responses: {
          200: {
            description: 'List of messages',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    messages: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Message' },
                    },
                    hasMore: { type: 'boolean' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Messages & Conversations'],
        summary: 'Send message via HTTP fallback',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Sends a message to the conversation over HTTP when WebSocket is temporarily unavailable.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ciphertext', 'nonce'],
                properties: {
                  ciphertext: { type: 'string' },
                  nonce: { type: 'string' },
                  messageType: { type: 'string', enum: ['text', 'image', 'video', 'audio', 'file'], default: 'text' },
                  mediaUrl: { type: 'string' },
                  clientGeneratedId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Message sent successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Message' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/{id}': {
      delete: {
        tags: ['Messages & Conversations'],
        summary: 'Delete a single message',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Message ID' },
          { name: 'deleteForEveryone', in: 'query', schema: { type: 'boolean', default: false } },
        ],
        responses: {
          200: { description: 'Message deleted' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/messages/{id}/reaction': {
      post: {
        tags: ['Messages & Conversations'],
        summary: 'Toggle emoji reaction',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Message ID' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['emoji'],
                properties: {
                  emoji: { type: 'string', example: '❤️' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Reaction updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    reactions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          emoji: { type: 'string' },
                          userId: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // GROUP CHATS
    // -------------------------------------------------------------------------
    '/api/groups': {
      post: {
        tags: ['Group Chats'],
        summary: 'Create a new group chat',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'participantEmails'],
                properties: {
                  name: { type: 'string', example: 'Mobile Engineering Team' },
                  description: { type: 'string', example: 'ChatUK React Native dev discussions' },
                  participantEmails: {
                    type: 'array',
                    items: { type: 'string', format: 'email' },
                    example: ['bob@example.com', 'charlie@example.com'],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Group created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Group' },
              },
            },
          },
          400: { description: 'Invalid group input' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/groups/{id}': {
      get: {
        tags: ['Group Chats'],
        summary: 'Get group details',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Group Conversation ID' },
        ],
        responses: {
          200: {
            description: 'Group details and members',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Group' },
              },
            },
          },
          404: { description: 'Group not found' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      put: {
        tags: ['Group Chats'],
        summary: 'Update group details',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Group updated' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/groups/{id}/participants': {
      post: {
        tags: ['Group Chats'],
        summary: 'Add participants to group',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['emails'],
                properties: {
                  emails: {
                    type: 'array',
                    items: { type: 'string', format: 'email' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Participants added' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/groups/{id}/participants/{userId}': {
      delete: {
        tags: ['Group Chats'],
        summary: 'Remove participant from group (Admin only)',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Participant removed' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Admin privileges required' },
        },
      },
    },
    '/api/groups/{id}/admins/{userId}': {
      put: {
        tags: ['Group Chats'],
        summary: 'Promote or demote group admin',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isAdmin'],
                properties: {
                  isAdmin: { type: 'boolean', example: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Admin role updated' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/groups/{id}/leave': {
      post: {
        tags: ['Group Chats'],
        summary: 'Leave group chat',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Successfully left the group' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // E2EE & DEVICES
    // -------------------------------------------------------------------------
    '/api/e2ee/devices': {
      post: {
        tags: ['E2EE & Devices'],
        summary: 'Register or update device public keys',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Registers Ed25519 signing public key and X25519 box public key with detached proof-of-possession signature.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId', 'signPublicKey', 'boxPublicKey', 'boxKeySignature'],
                properties: {
                  deviceId: { type: 'string', example: 'd0e12345-uuid-device' },
                  signPublicKey: { type: 'string', description: 'Base64 Ed25519 identity key' },
                  boxPublicKey: { type: 'string', description: 'Base64 X25519 prekey' },
                  boxKeySignature: { type: 'string', description: 'Base64 detached signature binding deviceId + boxPublicKey' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Device registered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    device: { $ref: '#/components/schemas/Device' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid signature or missing key parameters' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/e2ee/users/{userId}/devices': {
      get: {
        tags: ['E2EE & Devices'],
        summary: 'Get active devices and public keys for user',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'List of active devices with boxPublicKeys for encryption',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    devices: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Device' },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/e2ee/conversations/{id}/recipients': {
      get: {
        tags: ['E2EE & Devices'],
        summary: 'Get all recipient devices for a conversation',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Returns device public keys for all conversation participants for multi-recipient pairwise encryption.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Participant device key mapping',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    recipients: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          userId: { type: 'string' },
                          devices: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/Device' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/e2ee/backup': {
      post: {
        tags: ['E2EE & Devices'],
        summary: 'Store zero-knowledge encrypted backup',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Uploads user passphrase-derived encrypted key bundle. Server stores only opaque ciphertext without knowledge of keys.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ciphertext', 'nonce', 'salt'],
                properties: {
                  ciphertext: { type: 'string' },
                  nonce: { type: 'string' },
                  salt: { type: 'string' },
                  version: { type: 'integer', default: 1 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Encrypted backup stored successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      get: {
        tags: ['E2EE & Devices'],
        summary: 'Download encrypted backup',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: {
            description: 'Encrypted backup payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    backup: { $ref: '#/components/schemas/CloudBackup' },
                  },
                },
              },
            },
          },
          404: { description: 'No backup found' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      delete: {
        tags: ['E2EE & Devices'],
        summary: 'Delete encrypted cloud backup',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: { description: 'Backup deleted successfully' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // UPLOADS
    // -------------------------------------------------------------------------
    '/api/uploads/sign': {
      post: {
        tags: ['Uploads'],
        summary: 'Generate signed upload parameters for Cloudinary',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Generates secure cryptographic HMAC signature for direct client-to-Cloudinary upload under the `chatuk/` root folder.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  folder: { type: 'string', example: 'chatuk/MessageMedia' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Signed upload parameters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    signature: { type: 'string', example: '7d8a9b...' },
                    timestamp: { type: 'integer', example: 1730847600 },
                    public_id: { type: 'string', example: 'e2ee_550e8400-e29b-41d4-a716-446655440000' },
                    folder: { type: 'string', example: 'chatuk/MessageMedia' },
                    api_key: { type: 'string', example: '123456789012345' },
                    cloud_name: { type: 'string', example: 'chatuk-cloud' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/uploads/media': {
      post: {
        tags: ['Uploads'],
        summary: 'Server-side media upload (Fallback)',
        deprecated: true,
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        description: 'Fallback server-side upload endpoint for clients unable to upload directly to Cloudinary. Supports files up to 100MB.',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Media uploaded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    url: { type: 'string', example: 'https://res.cloudinary.com/.../file.mp4' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // CONTACT & FEEDBACK
    // -------------------------------------------------------------------------
    '/api/contact': {
      post: {
        tags: ['Contact'],
        summary: 'Submit inquiry or feedback',
        description: 'Dispatches user feedback, bug reports, or inquiries via Nodemailer to the dev team.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'category', 'message'],
                properties: {
                  name: { type: 'string', minLength: 2, example: 'Alex Smith' },
                  email: { type: 'string', format: 'email', example: 'alex@example.com' },
                  category: { type: 'string', example: 'Bug Report' },
                  message: { type: 'string', minLength: 10, example: 'When I rotate the screen during a call, video flips.' },
                  attachments: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['https://res.cloudinary.com/chatuk/image/upload/screenshot.png'],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Inquiry submitted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Your feedback has been submitted to the dev team. Thank you!' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
        },
      },
    },
  },
  components_responses: {
    Unauthorized: {
      description: 'Authentication token missing, invalid, or expired',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              error: { type: 'string', example: 'Unauthorized' },
              code: { type: 'string', example: 'UNAUTHORIZED' },
            },
          },
        },
      },
    },
  },
};

// Map components_responses into components.responses for strict OpenAPI 3.0 compliance
(swaggerSpec.components as any).responses = (swaggerSpec as any).components_responses;
delete (swaggerSpec as any).components_responses;

export const swaggerUiOptions = {
  customSiteTitle: 'ChatUK API Documentation',
  customCss: `
    .swagger-ui .topbar { background-color: #0f172a; border-bottom: 2px solid #3b82f6; }
    .swagger-ui .topbar .topbar-wrapper .link { display: flex; align-items: center; font-weight: bold; font-size: 1.2rem; color: #fff; }
    .swagger-ui .info { margin: 25px 0; }
    .swagger-ui .info .title { color: #1e293b; font-size: 2.2rem; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
  },
};
