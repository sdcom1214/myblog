# 클라우드 시작 지침

프로젝트는 `/workspace/myblog`입니다. Node.js **24 이상**이 필요합니다(Node 내장 SQLite 사용). 이 작업의 기존 체크아웃을 사용하며 별도 worktree는 만들지 않습니다. 의존성은 `npm ci`로 잠금 파일에 맞춰 설치합니다. `bash docs/setup.sh`는 설치·엔진/서버 테스트·빌드를 수행합니다.

```sh
cd /workspace/myblog
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

이 명령은 API 4174와 Vite 4173을 함께 실행합니다. 프로세스를 계속 유지하세요. 필요한 경우 `API_PORT=4175`처럼 변경할 수 있으며 Vite 프록시도 동일한 변수를 사용합니다. 포트 충돌 시 프로세스 명령과 상위 PID로 이 프로젝트에서 시작한 개발 매니저를 확인한 뒤 해당 매니저에 SIGTERM을 보내 정리합니다. 다른 작업의 서버는 중지하지 않습니다.

```sh
curl --fail --silent http://127.0.0.1:4173/api/health
npm test
npm run build
python tests/browser-smoke.py
node tests/browser-server.mjs
```

Health는 `{"ok":true,"persistence":"sqlite"}`를 반환해야 합니다. 브라우저 검증에는 Python Playwright와 `/usr/bin/chromium`이 필요합니다. 온라인 검증은 임시 메모리 DB와 빌드된 HTTP 서버를 자체 시작·종료하므로 개발 DB에 테스트 계정을 만들지 않습니다.

운영 방식으로 실행하려면 `npm run build` 후 `PORT=4173 npm start`를 사용합니다. 개발 서버와 같은 포트로 동시에 실행하지 않습니다. 서버 저장은 `.local/server.sqlite`에 유지되며 `.gitignore` 대상입니다. 별도 배포에는 영구 볼륨과 `FOOTBALL_DB` 경로를 지정합니다. 프로세스는 클라우드 게시 후 유지된다고 가정하지 않고 새 작업에서 위 명령으로 다시 시작합니다.

핵심 기능에 외부 서비스 비밀값은 필요 없습니다. Google 로그인은 선택 연결이며 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`를 안전한 환경 설정에 넣은 뒤 서버를 다시 시작해야 합니다. 콜백은 `/api/auth/google/callback`이고 HTTPS 운영 시 `COOKIE_SECURE=true`를 설정합니다. 이 값은 채팅·Git에 기록하지 않습니다. `.env.example`을 복사하는 것만으로 변수가 자동 주입되지 않습니다.

현재 인스턴스의 검증, 설정 초안 저장, 환경 게시(Publish)는 각각 별도입니다. 환경 게시나 GitHub 푸시가 이루어진 것으로 표시하지 않습니다. 사용자 전체 인터넷 액세스 설정은 유지합니다.
