import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool
} from "amazon-cognito-identity-js";

const USER_POOL_ID = process.env.REACT_APP_COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.REACT_APP_COGNITO_CLIENT_ID;

const getUserPool = () => {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error("Cognito configuration is missing.");
  }

  return new CognitoUserPool({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID
  });
};

const getCurrentCognitoUser = () => getUserPool().getCurrentUser();

const getSession = () =>
  new Promise((resolve, reject) => {
    const user = getCurrentCognitoUser();

    if (!user) {
      resolve(null);
      return;
    }

    user.getSession((error, session) => {
      if (error) {
        reject(error);
        return;
      }

      user.getUserAttributes((attributesError, attributes = []) => {
        if (attributesError) {
          reject(attributesError);
          return;
        }

        const mappedAttributes = Object.fromEntries(
          attributes.map((attribute) => [attribute.getName(), attribute.getValue()])
        );

        resolve({
          token: session.getIdToken().getJwtToken(),
          email: mappedAttributes.email || "",
          name: mappedAttributes.name || mappedAttributes.email || "",
          username: user.getUsername()
        });
      });
    });
  });

const signUp = ({ name, email, password }) =>
  new Promise((resolve, reject) => {
    const attributes = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
      new CognitoUserAttribute({ Name: "name", Value: name })
    ];

    getUserPool().signUp(email, password, attributes, [], (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });

const confirmSignUp = ({ email, code }) =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({
      Username: email,
      Pool: getUserPool()
    });

    user.confirmRegistration(code, true, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });

const signIn = ({ email, password }) =>
  new Promise((resolve, reject) => {
    const user = new CognitoUser({
      Username: email,
      Pool: getUserPool()
    });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password
    });

    user.authenticateUser(authDetails, {
      onSuccess: async () => {
        try {
          resolve(await getSession());
        } catch (sessionError) {
          reject(sessionError);
        }
      },
      onFailure: reject
    });
  });

const signOut = () => {
  const user = getCurrentCognitoUser();

  if (user) {
    user.signOut();
  }
};

export { getSession, signIn, signOut, signUp, confirmSignUp };
