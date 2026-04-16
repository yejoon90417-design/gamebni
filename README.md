# Game Suite

Socket.IO 기반 실시간 게임 모음입니다.

- `/` 라이어 게임
- `/bang` 뱅
- `/davinci` 다빈치 코드
- `/omok` 오목

## 배포

이 프로젝트는 Node 웹서비스로 배포해야 합니다. 정적 호스팅만으로는 동작하지 않습니다.

Render 기준으로 바로 올릴 수 있게 `render.yaml`을 넣어뒀습니다. 현재 설정은 `main` 브랜치에 커밋이 들어오면 자동배포되도록 되어 있습니다.

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Render에서 `New +` -> `Blueprint`를 선택합니다.
3. GitHub 저장소를 연결합니다.
4. Render가 루트의 `render.yaml`을 읽어서 웹서비스를 생성합니다.
5. 이후 `main` 브랜치에 push 하면 Render가 자동배포합니다.

## Git 초기 설정

로컬에서 아직 Git 저장소가 아니면 아래 순서로 시작하면 됩니다.

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin <github-repo-url>
git push -u origin main
```

그 다음부터는 아래만 하면 됩니다.

```bash
git add .
git commit -m "update"
git push
```

Render가 저장소와 연결된 상태라면 이 push가 자동배포를 트리거합니다.

## 확인 경로

- 앱: `/`
- 뱅: `/bang`
- 다빈치: `/davinci`
- 오목: `/omok`
- 헬스체크: `/healthz`

## 운영 메모

- 현재 방 데이터는 서버 메모리에만 있습니다.
- 서버가 재시작되면 진행 중인 방은 사라집니다.
- 이 구조는 단일 인스턴스 기준입니다. 여러 인스턴스로 늘리면 방 상태가 갈라질 수 있습니다.
- Render의 Free 인스턴스는 실사용 중 대기 시간이 생길 수 있습니다. 실제 사용이면 유료 인스턴스로 올리는 편이 낫습니다.
