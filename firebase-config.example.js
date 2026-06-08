// 1) 이 파일명을 firebase-config.js 로 변경하세요.
// 2) Firebase Console > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성에서 값을 복사해 넣으세요.
// 3) 이 파일은 GitHub 공개 저장소에 올라가도 Firebase 공식 구조상 API Key 자체는 비밀번호가 아니지만,
//    반드시 Firestore Rules와 Authentication으로 읽기/쓰기 권한을 제한해야 합니다.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
